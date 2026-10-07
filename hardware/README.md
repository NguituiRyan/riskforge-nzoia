# Risk Forge river node (hackathon build)

An ESP32 with an ultrasonic sensor stands in for a water-level node on Rwambwa Bridge.

## The chain into the model

```text
water in the tank (cm)
  → river stage at Rwambwa (m)
  → return period
  → JRC flood footprint
  → loss for every building
```

The dashboard shows each step live: **Live river node** on the map, and **Underwriter report → River node** for the detail.

## What to build tonight (about 5 hours)

| Part | Use | Notes |
|---|---|---|
| ESP32 DevKit (any) | MCU, USB serial, Wi-Fi | |
| HC-SR04 ultrasonic | Level | 2 cm minimum range, narrow beam: better than the JSN-SR04T in a small tank |
| 1 kΩ + 2 kΩ resistors | Echo voltage divider | The HC-SR04 echo is 5 V; ESP32 pins are 3.3 V |
| Clear container, 25 cm+ wide, 20–30 cm deep | The "river" | Float a foam disc on the water for a clean echo |
| Rigid arm or ruler, tape | Holds the sensor 25–30 cm above the tank floor, pointing down | |
| RGB LED + 3 × 220 Ω (optional) | Alert colour | The on-board LED blinks faster as the river rises |
| Jug of water, tray, towel | Demo | |

**Not built tonight. These go on the "production node" slide:**
- solar and LiFePO4 power;
- GSM/LoRa backhaul;
- rain gauge;
- pressure transducer;
- IP67 enclosure;
- radar level sensor (±5 mm over 0.5–10 m is radar-grade, not ultrasonic).

## Wiring

```text
HC-SR04 VCC  -> ESP32 VIN (5 V)
HC-SR04 GND  -> GND
HC-SR04 TRIG -> GPIO 5
HC-SR04 ECHO -> 1 kΩ -> GPIO 18 ;  GPIO 18 -> 2 kΩ -> GND
RGB LED      -> GPIO 25 / 26 / 27 through 220 Ω (common cathode to GND)   [optional]
```

## Flash and calibrate

1. Open `riskforge_node/riskforge_node.ino` in the Arduino IDE with the ESP32 board package installed. Select your board and port, then upload.
2. Open the Serial Monitor at **115200** baud. You should see a line every 500 ms, like `{"node":"RF-NZ-01","seq":12,"dist_cm":20.6,"level_cm":9.4,"ok":true}`.
3. Empty the tank and press **BOOT** (or send `z`). This saves the empty-tank distance.
4. **Close the Serial Monitor**: only one program can hold the port.

## Run the demo

1. Open the dashboard in **Chrome or Edge** on the laptop. Select **Live river node**, then **USB node**, then **Connect river node (USB)**, and pick the ESP32's port.
2. Check the scale: `1 cm = 0.30 m` of river stage, matching `STAGE_PER_CM` in the firmware.
3. Pre-fill the tank to about **8.5 cm**, which reads as 2.55 m: just under the 2.8 m alert level.
4. Pour one cup: the level crosses **Alert**, the 3D water rises over Budalangi, and the event loss and flooded-building count update.
5. Keep pouring past **16 cm** (4.8 m): the parametric trigger fires.
6. The fallbacks need no hardware: **Replay 2020** streams the real September 2020 GloFAS hydrograph, and **Simulate** gives a slider.

## Field path (Wi-Fi/GSM) and security

- Set `USE_WIFI 1` and fill in the Wi-Fi details plus `NODE_SECRET` from the repo's `.env` (never commit it). The node then POSTs every 10 s to `/api/node`.
- Each reading is signed: `sig = HMAC-SHA256(NODE_SECRET, "node|seq|ts|level_cm")`, with the level to one decimal.
- The server rejects a bad signature (401) and a timestamp older than 5 minutes (409, a possible replay). Otherwise it returns the stage, return period, alert level and LED colour.
- Test from the laptop:
  - `python scripts/send_test_reading.py 14 --url https://riskforge-nzoia.vercel.app/api/node` should be accepted.
  - Add `--forge` and it should be rejected.
- Why it matters: if a reading can trigger a parametric payout, a forged reading is fraud.

## Calibration and assumptions

- **Stage → return period** is an assumed table anchored on the published Rwambwa alert level (2.8 m ≈ onset of flooding, ~1-in-2). It's in `web/public/data/river_node.json`. In production, replace it with WRA's rating curve and the node's own record.
- **Frequency** is a Gumbel fit to GloFAS v4 annual maxima, 1997–2025. GloFAS is a model, so we use its return periods, not its absolute flows.
- **Warning time:** an upstream gauge gives under a day of warning (GloFAS peaks reach Rwambwa from Webuye within a day). Real lead time has to come from rainfall forecasts.
