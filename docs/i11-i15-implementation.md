# Реализация I11–I15

Это запись состояния до конца I15. Конструктор/парсинг/setters Date затем реализованы в [I16–I17](i16-i17-implementation.md). Date.getTimezoneOffset теперь возвращает целые минуты, как V8; точные исторические offsets сохранены внутри CalendarEngine.

12 ноября 2026. Код всех пяти шагов реализован по указанию пользователя. **119 тестов проходят**, обе сборки готовы. Реальная приёмка установленного расширения и M0 остаются неподтверждёнными; полноценная подмена времени ещё не завершена. I16 не начата.

## Результаты

| Шаг | Результат | Автоматизированная проверка |
| --- | --- | --- |
| I11 | watchPosition/clearWatch, отмена, кэш, ошибки, permission/lifecycle | 10 новых тестов watch; прежние 8 getCurrentPosition проходят |
| I12 | Default locale для доступных Intl и toLocale*/localeCompare | 7 тестов чисел, дат, сортировки, конструкторов, опций и ошибок |
| I13 | CalendarEngine на закреплённом Temporal-компоненте | 7 тестов с эталонами DST, суток, дробных offset и границ Date |
| I14 | Default timezone для DateTimeFormat/Date.toLocale*, частичный TimeRuntime | 4 теста форматирования + 2 теста координатора/диагностики |
| I15 | Локальные getters, строки Date и Date() без new | 11 тестов чтения, строк, UTC, ошибок, subclass и контрольных документов |

Итого добавлен 41 тест к 78 прежним. Полный `npm run check` прошёл: TypeScript, dist/dist-probe, состав manifest/HTML, лицензии и **119 тестов, 0 ошибок**. Локальный вывод сохранён в `artifacts/i11-i15-check.log`. Chrome API проверяются тестовыми объектами, страницы — Node VM, сервер — настоящим loopback HTTP. Это не результат установки в Chrome.

## I11 — наблюдение геолокации

Все три метода геолокации устанавливаются только при наличии нативного API в secure context и возможности изменить их дескрипторы. Решение браузера о permission и Permissions Policy сохраняется; denied не становится granted. При prompt штатный API открывает диалог, но его настоящая позиция не читается и не передаётся callback сайта. Для prompt-наблюдения используется отменяемый нативный watch, который снимается после решения/отмены.

У каждого наблюдения собственный положительный ID. clearWatch отменяет ещё не доставленные success/error, снимает permission listener и нативный prompt-watch. Неизвестный ID ничего не меняет. Callbacks асинхронны и не получают внутренний объект запроса через this.

**Профиль фиксированный:** после начальной позиции нет искусственного движения или периодических callbacks. Новые координаты требуют нового применения и reload. Нет повторяющегося таймера. Смена permission на denied завершает наблюдение ошибкой 1; TIMEOUT/UNAVAILABLE не становятся нативным успехом, подписку можно отменить. Периодические повторные попытки при неизменном профиле не выполняются.

maximumAge допускает повторное использование только достаточно свежей синтетической позиции с тем же enableHighAccuracy. При maximumAge 0 создаётся новая позиция. timeout 0 без подходящего кэша даёт ошибку 3. enableHighAccuracy сохраняется как hint и ключ кэша, не меняя заданную accuracy профиля. Ожидание видимости и permission не включается в timeout.

pagehide/dispose очищает подписки, задания и кэш. При pageshow новые вызовы снова доступны; восстановление прежних подписок после BFCache пока не обещается (I22). OFF снимает будущие регистрации; текущие обёртки до reload остаются синтетическими и не переключаются на настоящие координаты. Основа контракта: [W3C Geolocation](https://www.w3.org/TR/geolocation/).

## I12 — региональные форматы

Locale профиля используется при отсутствии locale/undefined и при пустом списке locale. Непустая явно заданная locale сохраняется, включая нативное поведение выбора поддержанного языка. Календарь, numberingSystem, hourCycle, currency, unit и остальные options сайта не заменяются.

Покрыты доступные Collator, DateTimeFormat, NumberFormat, PluralRules, RelativeTimeFormat, ListFormat, DisplayNames, Segmenter и DurationFormat. Отсутствующий необязательный API не создаётся. Intl.Locale, getCanonicalLocales и supportedValuesOf не подменяются.

Добавлены Number/BigInt/Date.toLocale*, String.localeCompare и locale-aware смена регистра. Array/TypedArray используют соответствующие методы элементов. Сохраняются нативная проверка receiver, Invalid Date, статические методы Intl, вызов допустимых конструкторов без new и subclass. Нативные параметры форматирования описаны в [ECMA-402](https://tc39.es/ecma402/).

## I13 — календарный движок

Компонент **@js-temporal/polyfill 0.5.1** и транзитивный **jsbi 4.3.2** закреплены lockfile и включены локально в MAIN bundle; загрузки кода с CDN нет. Лицензии ISC/Apache-2.0 скопированы в `dist/third-party`. Источник компонента: [js-temporal/temporal-polyfill](https://github.com/js-temporal/temporal-polyfill).

Правила IANA берутся из **нативного Intl/ICU браузера**. Отдельная база timezone не написана и не встроена. В автоматизированной среде: Node 22.23.2, ICU 78.2, tz 2026a, V8 12.4.254.21-node.56. Эти версии ICU/tz не приписываются Chrome: их браузерная версия отдельно не установлена.

CalendarEngine преобразует целый timestamp Date в ISO-локальные поля и обратно. Month движка — 1–12, dayOfWeek — Sunday=0. JS timezoneOffset имеет противоположный знак относительно восточного UTC offset и сохраняет исторические секунды как дробные минуты.

Для gap/overlap принята `compatible`: сдвиг вперёд при пропуске и первый instant при повторении. Также доступны earlier/later/reject. Эталоны включают Berlin/New York, UTC, Kathmandu/Kolkata, Lord Howe с получасовым DST, пропущенные сутки Apia, годы до н.э. и границы Date. Правила неоднозначности: [Temporal.ZonedDateTime](https://tc39.es/proposal-temporal/docs/zoneddatetime.html).

Перед обёртками времени выполняется быстрая самопроверка с независимыми фиксированными эталонами. При несовпадении TimeRuntime получает error, его чтения не устанавливаются и успешное покрытие не объявляется. Публичный global Temporal компонент не создаёт; подмена существующего Temporal относится к I18. Нормализация переполненных локальных компонентов для конструктора/setters пока не реализована.

## I14 — часовой пояс форматирования

Intl.DateTimeFormat и Date.toLocaleString/toLocaleDateString/toLocaleTimeString получают timezone профиля только при undefined. Явный UTC и любая другая явно заданная зона сохраняются. Явные некорректные значения дают нативную ошибку.

Options не мутируются: фасад сохраняет исходный receiver getters и порядок чтения полей нативным formatter, включая frozen/унаследованные свойства. Невалидная Date возвращает Invalid Date без лишней обработки options. Locale и timezone независимы: явная fr-FR сама по себе не отменяет default timezone профиля.

В отчёте документа есть locale, time и timeCoverage. **TIME_RUNTIME_COMPLETE=false**, time=partial. Координатор может зафиксировать успешную установку реализованных частей (committed), но состояние остаётся **LIMITED** с причиной незавершённого времени. Ошибка locale/time или отсутствие нужного покрытия не проходит verify.

## I15 — локальное чтение Date

Покрыты getFullYear/getYear/getMonth/getDate/getDay/getHours/getMinutes/getSeconds/getMilliseconds/getTimezoneOffset, toString/toDateString/toTimeString и Date() как функция. Getters сохраняют нативный timestamp; месяц возвращается 0–11, день недели Sunday=0. Строки Date используют английские имена дней/месяцев и GMT offset, как интерфейс Date; длинное имя зоны берётся из нативного Intl.

Не меняются Date.now, getTime/valueOf, UTC-getters/UTC-setters, Date.UTC, toISOString/toJSON/toUTCString/toGMTString и performance.now. Invalid Date и проверки receiver сохраняются; Date другого realm и subclass проверены. Нативный формат абсолютного времени: [ECMA-262 Date](https://tc39.es/ecma262/2025/multipage/numbers-and-dates.html).

**Конструктор с локальными компонентами, парсинг локальных строк, локальные setters и Temporal остаются нативными.** Поэтому создание/изменение даты пока может использовать системную зону, а чтение — профиль. Это явная граница I15, а не полная смена часового пояса. Соответствующие timeCoverage flags остаются false до I16–I18.

## Стенд и браузерная приёмка

Первый inline snapshot стенда дополнен числовыми форматами, зимней/летней датой, двумя переходами DST, timestamp/UTC/local/offset, явным UTC и покрытием TimeRuntime. Это позволяет сравнить реализованные чтения с контрольным документом до кода приложения.

Геолокация запрашивается только вручную: доступны timeout/maximumAge/enableHighAccuracy, getCurrentPosition, запуск watch и clearWatch. Последние 50 событий выводятся в странице; координаты не отправляются в серверный отчёт. Реальная контрольная страница использует собственный нативный API.

1. Пройти полный [I02/M0](i02-test-stand.md), очистить diagnostic probe, загрузить обычную dist и импортировать успешный отчёт для точного текущего Chrome. Предыдущий частичный снимок Chrome (номер версии удалён) не закрывает M0.
2. Выбрать профиль и разрешённый selected.localhost, исключить excluded.selected.localhost; оставить control.localhost контрольным. Применить/reload. Ожидается LIMITED с причиной частичного времени.
3. Сравнить первые числовые/датовые снимки selected, subdomain, excluded, control и iframe. Явные en-US/UTC должны сохраняться. Date ISO/timestamp должны совпадать с исходными.
4. Вручную проверить watch: начальный async fix, второй подписчик, clearWatch до/после callback, повторный clear, отказ и отзыв permission, timeout 0, кэш maximumAge и скрытый документ.
5. Выполнить OFF и reload; проверить нативные форматы, offset и отсутствие callbacks отменённого watch. Проверить перезапуск Chrome и ошибки worker/UI.

Пользователь подтвердил установку dist/dist-probe. Текстовое чтение Chrome работает; ранее поиск «Региональный профиль» вернул «Ничего не найдено». При попытке установки клик завершился «coordinate input geometry is unavailable», захват — «window capture timed out». После повторного выбора окна текст снова прочитан, но два клавиатурных действия (включая повтор после свежего наблюдения) были заблокированы: «user input was detected in this window; call get_window_state before continuing». Пользователь затем подтвердил доступность окна; управление возобновилось, но Computer Use остановил работу из-за невозможности надёжно определить текущий URL Chrome. Сборки пока не установлены; разрешение на установку сохраняется, повторного разрешения не требуется.

Нативные userScripts/DNR, permission dialog, реальный watch, отображение новых UI-блоков и lifecycle Chrome пока не приняты. M0 не обойдена: поздняя инъекция и отключение защитной проверки не используются. I16 не начиналась.
