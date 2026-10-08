# Risk Forge river node: a simple IoT flood sensor

An ESP32 with an ultrasonic sensor measures the water level in a tank that stands in for the Nzoia at Rwambwa Bridge. Over Wi-Fi it sends a signed reading every 3 seconds. The Risk Forge dashboard turns each reading into a return period and a loss for every insured building, on any laptop or phone.

```text
water in the tank (cm)  --Wi-Fi, signed-->  /api/node (verifies)  -->  dashboard: stage → return period → flood footprint → loss
```

## Parts

| Part | Use | Notes |
|---|---|---|
| ESP32 DevKit (any) | Microcontroller with Wi-Fi | |
| HC-SR04 ultrasonic | Water level | Minimum range 2 cm and a narrow beam, so it beats the waterproof JSN-SR04T in a small tank |
| 3 × 1 kΩ resistors | Echo voltage divider (1 kΩ, then 2 kΩ made from two 1 kΩ in series) | The HC-SR04 echo is 5 V; ESP32 pins are 3.3 V. Shops stock 1 kΩ but rarely a single 2 kΩ |
| Breadboard, jumper wires, USB cable | | Use a data cable: some cables only charge |
| Clear container, 25 cm+ wide, 20–30 cm deep | The "river" | Float a foam disc on the water for a clean echo |
| Rigid arm or ruler, tape | Holds the sensor 25–30 cm above the tank floor, pointing straight down | Keep it away from the tank walls |
| RGB LED + 3 × 220 Ω (optional) | Alert colour on the node | The on-board LED also blinks faster as the river rises |
| Phone hotspot | The node's internet | Must be **2.4 GHz**: ESP32s can't join 5 GHz. On an iPhone turn on *Maximise Compatibility* |
| Power bank | Runs the node with no laptop | Lets the node sit on the table on its own |
| Jug of water, tray, towel | Demo | |

**For the "production node" slide only (not built):**
- waterproof sensor: radar for ±5 mm over 0.5–10 m, or the JSN-SR04T;
- GSM/4G or LoRa instead of Wi-Fi;
- solar panel and battery;
- IP67 enclosure;
- rain gauge.

## What it costs

Listed prices at Kenyan shops on 7 Oct 2026 (Pixel Electric, Ktechnics, Jumia, Nerokas and others), before delivery. Several of the cheapest listings were out of stock, so check before you buy.

| Build | Parts | KES |
|---|---|---|
| **This demo node** | ESP32 DevKit 900–1,600 · HC-SR04 200–580 · breadboard, jumpers, resistors ~360 · RGB LED 20 | **about 2,000** (range 1,470–3,530) |
| **Field node, 2G** | ESP32 + JSN-SR04T waterproof sensor (1,000–1,300) + SIM800L/C (1,200–1,800) + 10 W panel (1,000–1,900) + CN3791 solar charger (400) + 2 × 18650 cells and holder + IP66 box (800) | **about 5,800** |
| **Field node, 4G** | as above with an A7672E 4G Cat-1 modem (~6,000) instead of 2G | **about 12,400–14,000** |

- **2G or 4G:** Kenya has no 2G switch-off date, but 2G use is falling fast, so 4G Cat-1 is the safer field choice.
- **Charging:** don't put a 12 V panel on a TP4056 charger (it takes about 8 V at most). Use the CN3791 12 V board, or a 6 V panel with the TP4056.
- **Radar sensors** (±5 mm) aren't sold locally. A SparkFun XM125 board is about KES 6,500 before shipping and duty, and an industrial 80 GHz unit about KES 200,000.

## Wiring

```text
HC-SR04 VCC  -> ESP32 VIN (5 V)
HC-SR04 GND  -> GND
HC-SR04 TRIG -> GPIO 5
HC-SR04 ECHO -> 1 kΩ -> GPIO 18 ;  GPIO 18 -> 2 kΩ (two 1 kΩ in series) -> GND
RGB LED      -> GPIO 25 / 26 / 27 through 220 Ω (common cathode to GND)   [optional]
```

## Build and flash

1. In the Arduino IDE, install the **esp32 by Espressif** board package, then select your board (e.g. *ESP32 Dev Module*) and its COM port.
2. In `riskforge_node/`, copy `secrets.example.h` to **`secrets.h`** and fill it in:
   - the hotspot name and password;
   - `NODE_SECRET`, copied from the repo's `.env`.

   `secrets.h` is git-ignored: never commit it. Without it, the node runs on USB only.
3. Open `riskforge_node.ino` and upload it.
4. Open the Serial Monitor at **115200** baud. You should see:
   - `{"event":"wifi","ok":true,"ip":"…"}` once it joins the hotspot;
   - a reading every 500 ms, like `{"node":"RF-NZ-01","seq":12,"dist_cm":20.6,"level_cm":9.4,"ok":true}`;
   - `{"event":"post","http":200,…}` every 3 s.
5. Empty the tank, then press **BOOT** (or send `z`). This saves the empty-tank distance, and the level now reads about 0 cm.

## Run the demo (Wi-Fi)

1. Power the node from the power bank, with the hotspot on.
2. Open https://riskforge-nzoia.vercel.app on the projector laptop. Select **Live river node**, then **Wi-Fi**. Within seconds it shows **Online over Wi-Fi · signature verified**. Judges can open the same page on their phones.
3. Check the scale: `1 cm = 0.30 m` of river stage.
4. Pre-fill the tank to about **8.5 cm**, which reads as 2.55 m: just under the 2.8 m alert level.
5. Pour one cup: within about 5 s the level crosses **Alert**, the 3D water rises over Budalangi, and the flooded buildings and event loss update.
6. At **14 cm** (4.2 m) the parametric trigger's first step pays 30%; keep pouring past **16 cm** (4.8 m) and it pays in full.
7. Security moment: run `python scripts/send_test_reading.py --forge --url https://riskforge-nzoia.vercel.app/api/node`, or press **Send a forged reading** under **Underwriter report → River node**. The panel shows the forgery as rejected.

**Fallbacks, in order:**
1. **USB.** Plug the node into the laptop (Chrome or Edge), select **USB**, then **Connect river node (USB)**. Close the Serial Monitor first.
2. **Replay.** Streams the real September 2020 GloFAS hydrograph. No hardware needed.
3. **Simulate.** A slider. No hardware needed.

**Rehearse without the node:** `python scripts/send_test_reading.py 8 --pour 18 --url https://riskforge-nzoia.vercel.app/api/node` behaves exactly like the node while you pour from 8 to 18 cm.

## Troubleshooting

| What you see | Likely cause |
|---|---|
| `"ok":false`, `dist_cm` -1 | The sensor gets no echo. Check TRIG/ECHO pins and the divider. Make sure the water is more than 2 cm below the sensor and nothing is in the beam. |
| Level jumps around | Ripples or the tank wall. Float the foam disc, point the sensor straight down, and centre it. |
| `"event":"wifi","ok":false` | Wrong hotspot name or password, or a 5 GHz-only hotspot. |
| `"skipped":"waiting for network time"` | The hotspot has no internet yet. Readings need a real clock to be signed. |
| `"http":401` | `NODE_SECRET` in `secrets.h` doesn't match the server's. Copy it again from `.env`. |
| `"http":409` | The clock is off, or the node re-sent an old reading. It recovers on the next reading. |
| Dashboard says **Offline** | The node stopped posting for 20 s. Check the power bank and the hotspot. |
| `"http":-1` | No connection to the server. Check the hotspot has data. |

## How the readings are protected

- Each reading is signed: `sig = HMAC-SHA256(NODE_SECRET, "node|seq|ts|level_cm")`, with the level to one decimal.
- The server rejects:
  - a bad signature (401);
  - a timestamp more than 5 minutes off (409);
  - a reading no newer than the last accepted one (409: a copied genuine reading is a replay).
- Rejections are counted, and the dashboard shows them.
- Why it matters: if a reading can trigger a parametric payout, a forged reading is fraud.
- The prototype keeps only the last few minutes, in Vercel's Runtime Cache. Production keeps the full record in a Kenyan-hosted database and pins the server certificate. The demo's `setInsecure()` skips that check.

## Calibration and assumptions

- **Tank → river:** 1 cm in the tank = 0.30 m at Rwambwa. This is a display scale, set in `STAGE_PER_CM` and in the dashboard's tank-scale box.
- **Stage → return period** is an assumed table anchored on the published Rwambwa alert level (2.8 m ≈ onset of flooding, ~1-in-2). It's in `web/public/data/river_node.json`. In production, replace it with WRA's rating curve and the node's own record.
- **Frequency** is a Gumbel fit to GloFAS v4 annual maxima, 1997–2025. GloFAS is a model, so we use its return periods, not its absolute flows.
- **Warning time:** a gauge at Rwambwa gives hours, not days. GloFAS peaks reach Rwambwa from Webuye within a day, so real lead time has to come from rainfall forecasts.
