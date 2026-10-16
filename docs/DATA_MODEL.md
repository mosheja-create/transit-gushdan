# מודל נתונים ראשוני

המודל הבא הוא מושגי. יש להתאים שדות ויחסים לאחר בחירת ספק הנתונים.

**עדכון 16.10.2026:** ספק הנתונים נבחר: GTFS של משרד התחבורה, וזמן אמת לפי SIRI. נוספו השדות שנדרשים להתאמה ביניהם, והישויות מאפיון 2.0 (פרק 9). הפורמט של קובצי הנתונים באב־הטיפוס מתועד ב־`docs/DATA_FORMAT.md`.

## TransitStop
- `id`: מזהה פנימי או מזהה ספק.
- `name`: שם התחנה.
- `lat`, `lon`: קואורדינטות אם זמינות.
- `provider_id`: מזהה אצל ספק המקור.
- `code`: קוד התחנה (`stop_code` ב־GTFS). זה המזהה ש־SIRI משתמש בו (`MonitoringRef`).
- `accessibility_metadata`: מידע נגישות, אם זמין.

## TransitLine
באפיון 2.0 הישות נקראת TransitService.
- `id`
- `name`
- `mode`: אוטובוס, רכבת, רכבת קלה וכדומה.
- `provider_id`: ה־`route_id` של ה־GTFS. זה גם `LineRef` של SIRI.
- `agency`: המפעיל.

## ScheduledTrip
- `id`
- `line_id`
- `service_date`
- `stop_times`: סדר תחנות ושעות מתוכננות.
- `origin_departure`: שעת היציאה מתחנת המוצא. משמשת להתאמה לזמן אמת (`OriginAimedDepartureTime`).
- `shape_dist`: מרחק לאורך המסלול לכל תחנה, כשהמקור מספק אותו.
- `source_updated_at`

## LiveObservation
- `line_id`, `origin_departure`: לאיזו נסיעה המדידה שייכת.
- `lat`, `lon`, `dist_from_start`, `recorded_at`.
- `source`: למשל Open Bus Stride או SIRI-SM.
- נשמר לזמן קצר בלבד. מיקום שעברו יותר מ־6 דקות מאז שנמדד לא משמש להערכה.

## RoutePlan
- `origin`, `destination`, `requested_at`, `mode` (יציאה או הגעה עד), `time`.
- `options`: חלופות ותוצאות הדירוג.

## RouteOption
- `id`
- `segments`: רשימת מקטעים מסודרת.
- `predicted_total_seconds`
- `walking_seconds`
- `waiting_seconds`
- `in_vehicle_seconds`
- `transfer_count`
- `confidence`: גבוהה, בינונית או נמוכה, עם הסבר. לא אחוז, כל עוד אין מודל מכויל.
- `score_components`
- `explanation`: למה החלופה הומלצה.

## RouteSegment
- `type`: walk / wait / ride / transfer / stop.
- `start_time`, `end_time`
- `from_location`, `to_location`
- `line_id` או `trip_id` כאשר רלוונטי.
- `predicted_seconds`
- `confidence`
- `data_source`: לוח זמנים, זמן אמת, אישי, הערכה או מחושב.
- `live`: זמן צפוי ואיחור, אם יש מידע בזמן אמת.

## UserPreferences
- `user_id` או מזהה מקומי.
- `walking_weight`
- `transfer_weight`
- `preferred_transfer_stops`
- `avoided_transfer_stops`
- `accessibility_preferences`
- `updated_at`

## SavedPlace
- שם שהמשתמש נתן, מיקום או מזהה מקום, סוג (בית, עבודה, אחר).

## TripSession
- `id`
- `user_id` או מזהה מקומי.
- `started_at`, `ended_at`
- `recording_consent`
- `status`
- `app_session_id`

## TripObservation
- `id`
- `trip_session_id`
- `observation_type`: מיקום, הגעה, עלייה, ירידה, מעבר או תיקון משתמש.
- `observed_at`
- `location` לפי מדיניות צמצום הנתונים.
- `accuracy_meters`
- `confidence`
- `source`: sensor / inference / user_correction.
- `quality_status`

## TripSegment
- `trip_session_id`, `type`, `start_time`, `end_time`, מרחק משוער.
- `data_source` ו־`confidence`.

## ObservedTransfer
- נקודת מוצא ונקודת יעד של המעבר, משך, הקשר (שעה ויום), ואיכות הזיהוי.

## UserCorrection
- תיקון של משתמש לאירוע או למקטע: מה היה, מה תוקן ומתי.

## PersonalEstimate
- `user_id`
- `estimate_type`: walking / waiting / transfer / ride.
- `context_key`: תחנה, קו, אזור או סוג הקשר.
- `estimate_seconds`
- `sample_count`
- `confidence`
- `last_updated_at`

## AggregatedMetric (שלב מתקדם)
- סוג המדד, חלון זמן, מספר דגימות ורמת איכות. מוצג רק מעל סף מינימלי של דגימות.

## FeedbackReport (שלב עתידי)
- סוג הדיווח, זמן, תחנה או שירות, סטטוס אימות ותוקף.

## Privacy rules
- לא לשמור מיקום מדויק מעבר לנדרש.
- לא להשתמש בנתוני משתמש ללמידה מצרפית ללא הסכמה מתאימה.
- לאפשר מחיקה של היסטוריית נסיעות.
- להפריד מזהים אישיים מנתוני מדידה ככל שניתן.
- לא לשמור נתוני GPS גולמיים ללא הגבלת זמן.
- לא לשלוח לשרת את מיקום המשתמש לצורך זמן אמת: מספיק לשלוח קודי תחנות או קווים.
