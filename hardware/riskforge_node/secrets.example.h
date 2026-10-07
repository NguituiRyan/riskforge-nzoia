// Copy this file to secrets.h (same folder) and fill it in. secrets.h is git-ignored: never commit it.
// With secrets.h present the node turns Wi-Fi on and posts signed readings; without it the node runs on USB only.
#pragma once

#define WIFI_SSID   "your-phone-hotspot"
#define WIFI_PASS   "hotspot-password"
#define API_URL     "https://riskforge-nzoia.vercel.app/api/node"
#define NODE_SECRET "paste NODE_SECRET from the repo's .env"
