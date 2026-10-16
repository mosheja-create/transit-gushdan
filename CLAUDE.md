# הוראות ל־Claude Code

קרא את `AGENTS.md` לפני כל עבודה, ופעל לפי `docs/RESPONSE_STYLE.md` בכל תשובה.

שפה: ענה למשתמש תמיד ורק בעברית, לאורך כל השיחה.

מצב נוכחי:
- אפיון מעודכן ומפת דרכים: ראה `docs/UPDATED_SPEC_LINKS.md`.
- **האתר (המוצר הנוכחי):** `site/` (מקור), נבנה ל־`public/` עם `scripts/build_site.sh`, ומתפרסם ל־GitHub Pages דרך `.github/workflows/deploy.yml`. פירוט: `docs/SITE.md`. בדיקות: `node tests/engine_test.mjs`.
- הדף פונה למנוע רק דרך `planTrip` (`site/js/engine.js`), כדי שאפשר יהיה לעבור בעתיד למנוע חינמי על שרת.
- אב־טיפוס ישן: `prototype-web/index.html` (מקור) ו־`prototype-web/dist/index.html` (בנוי, עם נתוני תל אביב).
- נתונים ליום שלם: `python3 scripts/build_gtfs_data.py --date YYYY-MM-DD` מוריד את ה־GTFS של משרד התחבורה ל־`data/cache/` וכותב `data/tlv_<date>_full.json` (אוטובוסים בתל אביב יפו, רכבת ישראל בכל הארץ). הפורמט: `docs/DATA_FORMAT.md`.
- עדכון יומי אוטומטי (04:30): `scripts/daily_update.sh` דרך הטיימר `transit-daily.timer` של systemd למשתמש. היומן: `data/cache/daily_update.log`.
- בנייה: `python3 scripts/build_prototype.py` (לוקח את קובץ היום השלם הכי חדש).
- בדיקות מנוע המסלולים: `node tests/routing_test.js`
- זמן אמת: באופן זמני מ־Open Bus Stride (מיקומי רכבים, באיחור של כדקתיים), ופעיל רק כשקובץ הנתונים הוא של היום. פירוט ב־`docs/REALTIME.md`.

האפיון הראשי: `docs/PRODUCT_SPEC.md` (גרסה 2.0), עם ההחלטות המאוחרות ב־`planning/DECISIONS.md`: קודם אתר ווב (החלטה 3), מנוע משלנו עם אפשרות למנוע חינמי בהמשך (החלטה 14).

השלבים הבאים: ראו `planning/CHECKLIST.md`.
