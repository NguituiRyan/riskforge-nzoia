/*
  Risk Forge river node - ESP32 + AJ-SR04M waterproof ultrasonic level sensor (hackathon demo build)
  The HC-SR04 still works: set SENSOR_AJ_SR04M to 0 below.

  What it does
    - Measures the distance to the water surface twice a second (median of 5 pings, temperature-compensated).
    - Level = (distance to the empty tank floor) - (distance to the water).
    - USB mode (always on): prints one JSON line every 500 ms at 115200 baud:
        {"node":"RF-NZ-01","seq":42,"dist_cm":40.6,"level_cm":9.4,"ok":true}
      The Risk Forge dashboard reads these straight from the browser (Web Serial, Chrome/Edge): Live river node -> USB node.
    - Wi-Fi mode (turns on when secrets.h exists - copy secrets.example.h): every 3 s POSTs an HMAC-SHA256-signed
      reading to /api/node. The dashboard's Live river node -> Wi-Fi view shows it on any laptop or phone.
      This is the same path a field node would use over GSM.

  Wiring (see hardware/README.md) - same for both sensors
    Sensor 5V/VCC -> 5V (VIN)      Sensor GND -> GND
    Sensor TRIG (AJ-SR04M: "Trig/RX") -> GPIO 5
    Sensor ECHO (AJ-SR04M: "Echo/TX") -> 1 kΩ -> GPIO 18, and GPIO 18 -> 2 kΩ -> GND   (divider: the sensor's 5 V echo must not reach the 3.3 V pin)
    No resistors? AJ-SR04M only: power it from 3V3 instead of VIN and wire ECHO straight to GPIO 18 (its echo is then 3.3 V).
    AJ-SR04M: leave the R19 pads empty (mode 1, HC-SR04 compatible). The probe plugs into the board's 2-pin socket.
    Status LED: on-board LED (GPIO 2). Optional RGB LED: R GPIO 25, G GPIO 26, B GPIO 27 (220 Ω each, common cathode).
    ESP32-S3 (DevKit, Super Mini and other minis): ECHO moves to GPIO 6, because the minis don't break out GPIO 18.
    Wire 3V3, GND, 5 (TRIG) and 6 (ECHO). The alert colour shows on the board's own RGB LED; GPIO 26-37 belong to the
    flash/PSRAM, so the RGB pins above are not used. Arduino IDE: board "ESP32S3 Dev Module", USB CDC On Boot: Enabled.

  Mounting (AJ-SR04M)
    It can't see anything nearer than about 20 cm, so the probe must sit at least 20 cm above the HIGHEST water.
    For the demo (up to ~20 cm of water) mount it about 50 cm above the bucket floor, centred, pointing straight down.

  Calibration
    Empty the tank, then press the BOOT button (GPIO 0) or send 'z' over serial: the empty distance is saved to flash.
    The reply shows max_level_cm, the deepest water the sensor can still measure from where it is mounted.
*/

#include <Arduino.h>
#include <Preferences.h>

// 1 = AJ-SR04M waterproof probe, 0 = HC-SR04. Same wiring and output either way.
#define SENSOR_AJ_SR04M 1

#if SENSOR_AJ_SR04M
const float MIN_CM = 20.0;              // blind zone: nearer "echoes" are the probe still ringing, not water
const float MAX_CM = 450.0;             // accuracy falls off past ~4.5 m
const unsigned int TRIG_US = 12;        // mode 1 wants a 10-15 µs trigger (1100 if R19 is fitted for low-power mode 2)
const unsigned long PING_GAP_MS = 60;   // let the probe stop ringing before the next ping
const float DEFAULT_EMPTY_CM = 50.0;
#else
const float MIN_CM = 2.0;
const float MAX_CM = 400.0;
const unsigned int TRIG_US = 10;
const unsigned long PING_GAP_MS = 25;
const float DEFAULT_EMPTY_CM = 30.0;
#endif
const float DEMO_HEADROOM_CM = 20.0;    // the demo pours to ~18 cm (Danger, 5.5 m): the sensor must see at least this deep

// Wi-Fi credentials and the signing key live in secrets.h (git-ignored). No secrets.h = USB-only node.
#if __has_include("secrets.h")
#include "secrets.h"
#define USE_WIFI 1
#else
#define USE_WIFI 0
#endif

#if USE_WIFI
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "mbedtls/md.h"
const unsigned long POST_EVERY_MS = 3000;
WiFiClientSecure tls;  // kept open between posts: one TLS handshake instead of one per reading
HTTPClient http;
#endif

const char* NODE_ID = "RF-NZ-01";
const int PIN_TRIG = 5;
#if CONFIG_IDF_TARGET_ESP32S3
const int PIN_ECHO = 6;  // S3 minis break out GPIO 1-13 only
const int PIN_RGB = 48;  // the board's addressable RGB LED: 48 on the DevKit and Super Mini, 47 on the LOLIN S3 Mini
#else
const int PIN_ECHO = 18;
const int PIN_LED = 2;
const int PIN_R = 25, PIN_G = 26, PIN_B = 27;
#endif
const int PIN_BOOT = 0;

const float AIR_TEMP_C = 25.0;          // replace with a BME280/DHT22 reading in production
const float STAGE_PER_CM = 0.30;        // demo scale: 1 cm in the tank = 0.30 m at Rwambwa (must match the dashboard)
const float ALERT_M = 2.8, WARNING_M = 4.2, DANGER_M = 5.5;

Preferences prefs;
float emptyDistCm = DEFAULT_EMPTY_CM;  // distance from the sensor to the empty tank floor; overwritten by calibration
uint32_t seq = 0;
unsigned long lastPrint = 0, lastPost = 0, lastWifiCheck = 0;
float lastLevel = 0;
bool lastMeasureOk = false;

float pingCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(3);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(TRIG_US);
  digitalWrite(PIN_TRIG, LOW);
  unsigned long us = pulseIn(PIN_ECHO, HIGH, 30000);  // 30 ms timeout ~ 5 m
  if (us == 0) return NAN;
  float speed = 331.3 + 0.606 * AIR_TEMP_C;            // m/s, temperature-compensated
  return (us * 1e-6f * speed / 2.0f) * 100.0f;          // cm
}

float medianDistanceCm() {
  float v[5];
  int n = 0;
  for (int i = 0; i < 5; i++) {
    float d = pingCm();
    if (!isnan(d) && d >= MIN_CM && d <= MAX_CM) v[n++] = d;
    delay(PING_GAP_MS);
  }
  if (n == 0) return NAN;
  for (int i = 1; i < n; i++)
    for (int j = i; j > 0 && v[j - 1] > v[j]; j--) { float t = v[j]; v[j] = v[j - 1]; v[j - 1] = t; }
  return v[n / 2];
}

void setRgb(bool r, bool g, bool b) {
#if CONFIG_IDF_TARGET_ESP32S3
  static int last = -1;  // the S3's LED is addressable: rewrite it only when the colour changes
  int now = r << 2 | g << 1 | b;
  if (now == last) return;
  last = now;
  rgbLedWrite(PIN_RGB, r ? 40 : 0, g ? 40 : 0, b ? 40 : 0);  // dimmed: full brightness is glaring
#else
  digitalWrite(PIN_R, r);
  digitalWrite(PIN_G, g);
  digitalWrite(PIN_B, b);
#endif
}

void showLocalAlert(float stageM) {
  // amber = alert, red = warning/danger, green = normal; on-board LED blinks faster as the river rises
  if (stageM >= WARNING_M) setRgb(1, 0, 0);
  else if (stageM >= ALERT_M) setRgb(1, 1, 0);
  else setRgb(0, 1, 0);
#if !CONFIG_IDF_TARGET_ESP32S3
  int period = stageM >= DANGER_M ? 150 : stageM >= WARNING_M ? 300 : stageM >= ALERT_M ? 700 : 2000;
  digitalWrite(PIN_LED, (millis() / period) % 2);
#endif
}

void calibrate() {
  float d = medianDistanceCm();
  if (isnan(d)) {
    Serial.println("{\"event\":\"calibrate\",\"ok\":false}");
    return;
  }
  emptyDistCm = d;
  prefs.putFloat("empty", emptyDistCm);
  float headroom = emptyDistCm - MIN_CM;  // water deeper than this sits in the blind zone
  Serial.printf("{\"event\":\"calibrate\",\"ok\":true,\"empty_cm\":%.1f,\"max_level_cm\":%.1f%s}\n", emptyDistCm, headroom,
                headroom < DEMO_HEADROOM_CM ? ",\"warn\":\"mount the sensor higher\"" : "");
}

#if USE_WIFI
String hmacHex(const char* key, const String& msg) {
  uint8_t out[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)key, strlen(key));
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)msg.c_str(), msg.length());
  mbedtls_md_hmac_finish(&ctx, out);
  mbedtls_md_free(&ctx);
  char hex[65];
  for (int i = 0; i < 32; i++) sprintf(hex + 2 * i, "%02x", out[i]);
  hex[64] = 0;
  return String(hex);
}

void wifiStatus() {
  // report joins and drops once, so the serial log shows what the node is doing
  static int last = -1;
  int now = WiFi.status() == WL_CONNECTED;
  if (now == last) return;
  last = now;
  if (now) Serial.printf("{\"event\":\"wifi\",\"ok\":true,\"ip\":\"%s\",\"rssi\":%d}\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  else Serial.printf("{\"event\":\"wifi\",\"ok\":false,\"ssid\":\"%s\"}\n", WIFI_SSID);
}

void postReading(float levelCm) {
  if (WiFi.status() != WL_CONNECTED) return;
  time_t ts = time(nullptr);
  if (ts < 1700000000) {  // clock not set from NTP yet: the server would refuse the timestamp
    Serial.println("{\"event\":\"post\",\"skipped\":\"waiting for network time\"}");
    return;
  }
  String level = String(levelCm, 1);  // one decimal, matching the server's canonical message
  String msg = String(NODE_ID) + "|" + String(seq) + "|" + String((long)ts) + "|" + level;
  String body = "{\"node\":\"" + String(NODE_ID) + "\",\"seq\":" + String(seq) + ",\"ts\":" + String((long)ts) + ",\"level_cm\":" + level + ",\"sig\":\"" + hmacHex(NODE_SECRET, msg) + "\"}";
  http.begin(tls, API_URL);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  String reply = http.getString();
  http.end();
  Serial.printf("{\"event\":\"post\",\"http\":%d,\"reply\":%s}\n", code, reply.length() ? reply.c_str() : "null");
}
#endif

void setup() {
  Serial.begin(115200);
#if ARDUINO_USB_CDC_ON_BOOT
  // native USB re-enumerates after a reset: give the Serial Monitor up to 2 s to reconnect so the boot line isn't lost
  for (unsigned long t = millis(); !Serial && millis() - t < 2000;) delay(10);
#endif
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
#if !CONFIG_IDF_TARGET_ESP32S3
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_R, OUTPUT);
  pinMode(PIN_G, OUTPUT);
  pinMode(PIN_B, OUTPUT);
#endif
  pinMode(PIN_BOOT, INPUT_PULLUP);
  prefs.begin("riskforge", false);
  emptyDistCm = prefs.getFloat("empty", emptyDistCm);
  Serial.printf("{\"event\":\"boot\",\"node\":\"%s\",\"sensor\":\"%s\",\"empty_cm\":%.1f,\"max_level_cm\":%.1f}\n", NODE_ID,
                SENSOR_AJ_SR04M ? "AJ-SR04M" : "HC-SR04", emptyDistCm, emptyDistCm - MIN_CM);
#if USE_WIFI
  tls.setInsecure();  // demo only: pin the server certificate in production
  http.setReuse(true);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  configTime(0, 0, "pool.ntp.org", "time.google.com");  // signed readings carry a real timestamp
#else
  Serial.println("{\"event\":\"wifi\",\"ok\":false,\"note\":\"USB only - add secrets.h for Wi-Fi\"}");
#endif
}

void loop() {
  if (digitalRead(PIN_BOOT) == LOW) {
    delay(50);
    if (digitalRead(PIN_BOOT) == LOW) calibrate();
    while (digitalRead(PIN_BOOT) == LOW) delay(10);
  }
  if (Serial.available() && tolower(Serial.read()) == 'z') calibrate();

  if (millis() - lastPrint >= 500) {
    lastPrint = millis();
    float d = medianDistanceCm();
    bool ok = !isnan(d);
    lastMeasureOk = ok;
    if (ok) lastLevel = max(0.0f, emptyDistCm - d);
    seq++;
    Serial.printf("{\"node\":\"%s\",\"seq\":%lu,\"dist_cm\":%.1f,\"level_cm\":%.1f,\"ok\":%s}\n", NODE_ID, (unsigned long)seq, ok ? d : -1.0, lastLevel, ok ? "true" : "false");
  }
  showLocalAlert(lastLevel * STAGE_PER_CM);

#if USE_WIFI
  if (millis() - lastWifiCheck >= 1000) {
    lastWifiCheck = millis();
    wifiStatus();
  }
  if (millis() - lastPost >= POST_EVERY_MS) {
    lastPost = millis();
    if (lastMeasureOk) postReading(lastLevel);
  }
#endif
}
