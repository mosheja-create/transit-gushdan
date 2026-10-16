# קישורים למסמכים מעודכנים

- האפיון הראשי הוא גרסה 2.0, בקובץ `docs/PRODUCT_SPEC.md`.
- אפיון ומפת דרכים קודמים (גרסה 1.1, הוחלפו בגרסה 2.0): https://claude.ai/code/artifact/8abe6530-7b76-45ee-acc0-b73d434791e1
- אב־טיפוס ווב (נתוני דוגמה בדויים): https://claude.ai/artifact/DP4FvFo8vprTR6WCHKnTiW
  הקוד המקומי: `prototype-web/index.html`

## נתונים אמיתיים (שלב 0)
- `data/tlv_2026-10-15_0700-0930.json`: תחנות, קווים ולוחות זמנים של תל אביב יפו ליום חמישי 15.10.2026, 07:00–09:30, מתוך ה־GTFS של משרד התחבורה דרך Open Bus Stride API.
- `data/tlv_2026-10-18_full.json`: יום ראשון 18.10.2026, כל היום, מתוך קובץ ה־GTFS המלא של משרד התחבורה. אוטובוסים, רכבת קלה ומוניות שירות בתוך תל אביב יפו, ורכבת ישראל בכל הארץ. נבנה עם `scripts/build_gtfs_data.py`; הפורמט ב־`docs/DATA_FORMAT.md`.
- `scripts/build_prototype.py`: בונה את `prototype-web/dist/index.html` עם קובץ היום השלם הכי חדש.
- זמן אמת: `docs/REALTIME.md` (זמני: Open Bus Stride; פעיל רק כשקובץ הנתונים הוא של היום).
- `tests/routing_test.js`: בדיקות מנוע המסלולים (`node tests/routing_test.js`).
