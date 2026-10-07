/*
  Risk Forge river node - ESP32 + HC-SR04 ultrasonic level sensor (hackathon demo build)

  What it does
    - Measures the distance to the water surface every 200 ms (median of 5 pings, temperature-compensated).
    - Level = (distance to the empty tank floor) - (distance to the water).
    - USB mode (always on): prints one JSON line every 500 ms at 115200 baud:
        {"node":"RF-NZ-01","seq":42,"dist_cm":20.6,"level_cm":9.4,"ok":true}
      The Risk Forge dashboard reads these straight from the browser (Web Serial, Chrome/Edge): Live river node -> USB node.
    - Wi-Fi mode (turns on when secrets.h exists - copy secrets.example.h): every 3 s POSTs an HMAC-SHA256-signed
      reading to /api/node. The dashboard's Live river node -> Wi-Fi view shows it on any laptop or phone.
      This is the same path a field node would use over GSM.

  Wiring (see hardware/README.md)
    HC-SR04 VCC -> 5V (VIN)      HC-SR04 GND -> GND
    HC-SR04 TRIG -> GPIO 5
    HC-SR04 ECHO -> 1 kΩ -> GPIO 18, and GPIO 18 -> 2 kΩ -> GND   (divider: the sensor's 5 V echo must not reach the 3.3 V pin)
    Status LED: on-board LED (GPIO 2). Optional RGB LED: R GPIO 25, G GPIO 26, B GPIO 27 (220 Ω each, common cathode).

  Calibration
    Empty the tank, then press the BOOT button (GPIO 0) or send 'z' over serial: the empty distance is saved to flash.
*/

#include <Arduino.h>
#include <Preferences.h>

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
const int PIN_ECHO = 18;
const int PIN_LED = 2;
const int PIN_R = 25, PIN_G = 26, PIN_B = 27;
const int PIN_BOOT = 0;

const float AIR_TEMP_C = 25.0;          // replace with a BME280/DHT22 reading in production
const float STAGE_PER_CM = 0.30;        // demo scale: 1 cm in the tank = 0.30 m at Rwambwa (must match the dashboard)
const float ALERT_M = 2.8, WARNING_M = 4.2, DANGER_M = 5.5;

Preferences prefs;
float emptyDistCm = 30.0;  // distance from the sensor to the empty tank floor; overwritten by calibration
uint32_t seq = 0;
unsigned long lastPrint = 0, lastPost = 0, lastWifiCheck = 0;
float lastLevel = 0;

float pingCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(3);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
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
    if (!isnan(d) && d > 1.0 && d < 400.0) v[n++] = d;
    delay(25);
  }
  if (n == 0) return NAN;
  for (int i = 1; i < n; i++)
    for (int j = i; j > 0 && v[j - 1] > v[j]; j--) { float t = v[j]; v[j] = v[j - 1]; v[j - 1] = t; }
  return v[n / 2];
}

void setRgb(bool r, bool g, bool b) {
  digitalWrite(PIN_R, r);
  digitalWrite(PIN_G, g);
  digitalWrite(PIN_B, b);
}

void showLocalAlert(float stageM) {
  // amber = alert, red = warning/danger, green = normal; on-board LED blinks faster as the river rises
  if (stageM >= WARNING_M) setRgb(1, 0, 0);
  else if (stageM >= ALERT_M) setRgb(1, 1, 0);
  else setRgb(0, 1, 0);
  int period = stageM >= DANGER_M ? 150 : stageM >= WARNING_M ? 300 : stageM >= ALERT_M ? 700 : 2000;
  digitalWrite(PIN_LED, (millis() / period) % 2);
}

void calibrate() {
  float d = medianDistanceCm();
  if (isnan(d)) {
    Serial.println("{\"event\":\"calibrate\",\"ok\":false}");
    return;
  }
  emptyDistCm = d;
  prefs.putFloat("empty", emptyDistCm);
  Serial.printf("{\"event\":\"calibrate\",\"ok\":true,\"empty_cm\":%.1f}\n", emptyDistCm);
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
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_R, OUTPUT);
  pinMode(PIN_G, OUTPUT);
  pinMode(PIN_B, OUTPUT);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  prefs.begin("riskforge", false);
  emptyDistCm = prefs.getFloat("empty", emptyDistCm);
  Serial.printf("{\"event\":\"boot\",\"node\":\"%s\",\"empty_cm\":%.1f}\n", NODE_ID, emptyDistCm);
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
    postReading(lastLevel);
  }
#endif
}
