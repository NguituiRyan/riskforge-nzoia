# Sample broker offers

Two fictional offers to try the AI analyst. Open the live app, go to **Underwriter report → AI analyst**, and either drop one of these files or click **try a sample**.

| File | Site | Expected verdict | Why |
|---|---|---|---|
| `offers/approve_mukhobola_dairy` (.pdf, .docx) | Mukhobola, edge of the flood plain (0.68 m at 1-in-100 on the JRC map) | **APPROVE** | Raised concrete buildings, one minor flood in 15 years; the offered premium for Kenya Re's 40% is 125% of the model's technical price |
| `offers/decline_rugunga_rice_mill` (.pdf, .docx) | Rugunga, deep flood plain (2.59 m at 1-in-100) | **DECLINE AT OFFERED TERMS** | Iron-sheet and mixed buildings at ground level, three floods in 8 years (KES 70.9M claimed); the premium is 16% of the technical price. Counter-offer: raise the premium or the deductible to about KES 25M |

The companies, people, phone numbers (+254 700 000 xxx) and emails (example.com) are all made up. The contact lines are there on purpose: the app removes them in the browser before the AI reads the text.

Both were run end to end through the AI on 8 October 2026: 24 of 24 quoted figures verified in each, and the verdicts above.

Regenerate with `python samples/make_offers.py` (needs `reportlab` and `python-docx`). It also copies the PDFs to `web/public/samples/` for the in-app buttons.
