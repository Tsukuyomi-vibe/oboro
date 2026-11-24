// @ts-check
// Classic, local-only bootstrap: runs before styles/modules on every UI page.
// UI language is independent of the regional profile and browser language.
(() => {
  /** @type {Readonly<Record<string, string>>} */
  const messages = Object.freeze({
    "Язык": "Language",
    "Тема": "Theme",
    "Как в системе": "System",
    "Светлая": "Light",
    "Тёмная": "Dark",
    "Тема изменена для этого окна. Не удалось сохранить выбор.": "Theme changed for this window. Your choice could not be saved.",
    "Язык изменён для этого окна. Не удалось сохранить выбор.": "Language changed for this window. Your choice could not be saved.",
    "Настройки — oboro": "Settings — oboro",
    "Диагностика oboro — Oboro Check": "oboro diagnostics — Oboro Check",
    "Ваш регион в браузере": "Your region in the browser",
    "Настройки расширения": "Extension settings",
    "Один профиль.": "One profile.",
    "Выбранные вами сайты.": "The sites you choose.",
    "Настройте языки, геолокацию, форматы, часовой пояс и карту раскладки. Сохраните профиль, выберите сайты и примените изменения. Явные часовые пояса сохраняются; неоднозначные строки дат вроде 01/02/2024 не разбираются.": "Set languages, geolocation, formats, time zone and keyboard map. Save a profile, choose sites and apply your changes. Explicit time zones are preserved; ambiguous date strings such as 01/02/2024 are not parsed.",
    "Загрузка…": "Loading…",
    "Чтение состояния расширения…": "Reading extension status…",
    "Состояние расширения": "Extension status",
    "Общий выключатель": "Master switch",
    "Включён": "On",
    "Выключен": "Off",
    "Выключено": "Off",
    "Применение…": "Applying…",
    "Применено к документам": "Applied to documents",
    "Ограничено": "Limited",
    "Ошибка": "Error",
    "Нужна перезагрузка": "Reload required",
    "Вне области действия": "Out of scope",
    "Не настроено": "Not configured",
    "Сайт исключён": "Site excluded",
    "Нужен доступ": "Access required",
    "Ошибка чтения": "Could not read status",
    "Применение перезагрузит выбранные основные страницы. Доступы и ограничения показаны в настройках.": "Applying will reload selected top-level pages. See settings for access and coverage limits.",
    "Применение перезагрузит выбранные основные страницы. Для уже открытых iframe на других сайтах может потребоваться ручная перезагрузка.": "Applying will reload selected top-level pages. Existing cross-site iframes may need a manual reload.",
    "Применить и перезагрузить выбранные страницы": "Apply and reload selected pages",
    "Отключить и повторить очистку": "Disable and retry cleanup",
    "Определение текущего сайта…": "Checking the current site…",
    "Открыть настройки": "Open settings",
    "Профиль применяется только к выбранным адресам с выданным доступом. Date, Intl и доступный Temporal.Now используют часовой пояс профиля по умолчанию. Явные зоны сохраняются.": "The profile applies only to selected addresses with granted access. Date, Intl and available Temporal.Now use the profile time zone by default. Explicit zones are preserved.",
    "Активная конфигурация: «{0}», версия {1}.": "Active configuration: “{0}”, revision {1}.",
    "Сохранён профиль «{0}», версия {1}. Активной конфигурации нет.": "Saved profile: “{0}”, revision {1}. No active configuration.",
    "Сохранён профиль «{0}», версия {1}. Активной конфигурации нет. Старые документы требуют перезагрузки.": "Saved profile: “{0}”, revision {1}. No active configuration. Existing documents need to be reloaded.",
    " Старые документы требуют перезагрузки.": " Existing documents need to be reloaded.",
    "Сохранённого профиля нет.": "No saved profile.",
    "Подмена API для этого документа не выбрана. Общий выключатель управляет всеми выбранными сайтами.": "API overrides are not selected for this document. The master switch controls all selected sites.",
    "Сайт выбран, но Chrome ещё не выдал необходимый доступ.": "This site is selected, but the required Chrome access has not been granted.",
    "Перезагрузить вкладку {0}": "Reload tab {0}",
    "Сохраните профиль или загрузите сохранённые значения перед применением.": "Save the profile or load the saved values before applying.",
    "Выполняется…": "Working…",
    "Отчёт Chrome принят. Примените профиль.": "Chrome report accepted. Apply your profile.",
    "Команда завершена; результат показан в состоянии расширения.": "Command completed. See the extension status for the result.",
    "Отчёт слишком велик: максимум 1,5 МБ.": "The report is too large: maximum 1.5 MB.",
    "Не удалось прочитать JSON-отчёт.": "Could not read the JSON report.",
    "Чтение профиля…": "Reading profile…",
    "Подмены не применяются.": "Overrides are not applied.",
    "Профиль ещё не сохранён": "No saved profile yet",
    "Заполните форму ниже или подставьте пример. До сохранения и применения подмены не включаются.": "Fill in the form below or use the example. Overrides stay off until the profile is saved and applied.",
    "Сохранённая версия: {0}. Изменения вступают в силу после применения и перезагрузки выбранных страниц.": "Saved revision: {0}. Changes take effect after applying and reloading selected pages.",
    "Языки": "Languages",
    "Форматы": "Formats",
    "Часовой пояс": "Time zone",
    "Координаты": "Coordinates",
    "Точность": "Accuracy",
    "Карта раскладки": "Keyboard map",
    "{0} м": "{0} m",
    "Не удалось прочитать профиль": "Could not read the profile",
    "Откройте настройки ещё раз. Сохранённые данные оставлены без изменений.": "Reopen settings. Saved data has been kept unchanged.",
    "Региональный профиль": "Regional profile",
    "Звёздочкой отмечены обязательные поля. Пустые дополнительные геопараметры означают «неизвестно»; ноль сохраняется как значение.": "An asterisk marks required fields. Empty optional geolocation fields mean “unknown”; zero is saved as a value.",
    "Параметры профиля": "Profile parameters",
    "Название": "Name",
    "Широта": "Latitude",
    "Долгота": "Longitude",
    "Высота": "Altitude",
    "Точность высоты": "Altitude accuracy",
    "Скорость": "Speed",
    "Направление": "Heading",
    "Локаль форматов": "Formatting locale",
    "Название *": "Name *",
    "Широта *": "Latitude *",
    "Долгота *": "Longitude *",
    "Точность, м *": "Accuracy, m *",
    "Высота, м": "Altitude, m",
    "Точность высоты, м": "Altitude accuracy, m",
    "Скорость, м/с": "Speed, m/s",
    "Направление, 0–359,999°": "Heading, 0–359.999°",
    "Часовой пояс *": "Time zone *",
    "Локаль форматов *": "Formatting locale *",
    "Языки в порядке предпочтения *": "Languages in order of preference *",
    "Неизвестно": "Unknown",
    "От 1 до 10 тегов через запятую или пробел. Первый язык используется в navigator.language; порядок определяет Accept-Language.": "Enter 1 to 10 tags separated by commas or spaces. The first language is used for navigator.language; the order determines Accept-Language.",
    "Меняется только getLayoutMap при доступном Keyboard Map API. Набор текста, KeyboardEvent.key/code, сочетания клавиш и IME остаются системными. Изменение карты требует применения и перезагрузки страниц.": "Only getLayoutMap changes, when the Keyboard Map API is available. Typing, KeyboardEvent.key/code, shortcuts and IME keep their system behavior. Apply the profile and reload pages to change the map.",
    "Системная карта (без подмены)": "System map (no override)",
    "Английская — US QWERTY": "English — US QWERTY",
    "Немецкая — DE QWERTZ": "German — DE QWERTZ",
    "Русская — RU ЙЦУКЕН": "Russian — RU JCUKEN",
    "Сохранить профиль": "Save profile",
    "Подставить пример «Берлин»": "Use Berlin example",
    "Загрузить сохранённые значения в форму": "Load saved values into the form",
    "Загрузка сохранённого профиля…": "Loading saved profile…",
    "Сохранённое состояние нужно перечитать. Правки оставлены в форме. Загрузите сохранённые значения перед новой записью.": "The saved state needs to be read again. Your edits are still in the form. Load saved values before saving again.",
    "Есть несохранённые изменения. Сохраните профиль перед применением.": "You have unsaved changes. Save the profile before applying.",
    "Сохранённая версия: {0}. Применение и перезагрузка выполняются отдельной кнопкой.": "Saved revision: {0}. Use the separate button to apply and reload.",
    "Профиль ещё не сохранён. Заполните поля или подставьте пример": "No saved profile yet. Fill in the fields or use the example",
    "Загружена новая сохранённая версия профиля. Проверьте значения перед применением.": "A new saved profile revision has been loaded. Check the values before applying.",
    "Сохранение…": "Saving…",
    "Профиль «{0}» сохранён, версия {1}. Примените его и перезагрузите выбранные страницы.": "Profile “{0}” saved, revision {1}. Apply it and reload selected pages.",
    "Пример подставлен в форму. Для записи нажмите «Сохранить профиль».": "The example is in the form. Click “Save profile” to save it.",
    "Область действия": "Scope",
    "Выбор сайтов": "Site selection",
    "Только выбранные сайты": "Selected sites only",
    "Все сайты с уже выданным доступом": "All sites with granted access",
    "Переключение сохраняет списки сайтов и исключений. Новые разрешения не запрашиваются. В режиме «Все сайты» будущий выданный доступ также включает адрес; исключения действуют всегда.": "Switching keeps your site and exclusion lists. It does not request new permissions. In “All sites” mode, future access grants also select those addresses; exclusions always apply.",
    "Сохранить режим": "Save mode",
    "Подмена API относится к документу, сетевой заголовок — к адресату запроса. Исключения важнее включений.": "API overrides apply to the document; the network header applies to the request destination. Exclusions take priority over inclusions.",
    "Хост": "Host",
    "Действие": "Action",
    "Выбрать сайт": "Select site",
    "Исключить сайт": "Exclude site",
    "Выдать только доступ": "Grant access only",
    "Включая поддомены": "Include subdomains",
    "Добавить": "Add",
    "Загрузка списка…": "Loading list…",
    "Выданные доступы": "Granted access",
    "Режим: все адреса с выданным доступом, кроме исключений. Новое разрешение включает адрес в этом режиме.": "Mode: all addresses with granted access, except exclusions. Granting access selects an address in this mode.",
    "Режим: только явно выбранные сайты. Выданное разрешение само по себе не выбирает сайт.": "Mode: explicitly selected sites only. Granting access alone does not select a site.",
    "Выдать доступ (адрес будет выбран в этом режиме)": "Grant access (selects the address in this mode)",
    "Сохранить сайт и выдать доступ": "Save site and grant access",
    "Исключён": "Excluded",
    "Выбран": "Selected",
    "Сохранён в списке": "Saved in list",
    "Доступ выдан": "Access granted",
    "Выдать доступ": "Grant access",
    "Доступ выдан. Примените профиль.": "Access granted. Apply your profile.",
    "Доступ не выдан; сайт остаётся выбранным без доступа.": "Access was not granted; the site remains selected without access.",
    "Удалить": "Remove",
    "Правило удалено. Выбор определяется текущим режимом и доступами. Открытым документам может понадобиться перезагрузка.": "Rule removed. Selection depends on the current mode and access grants. Open documents may need a reload.",
    "Отдельных правил нет. Выбраны адреса с выданными разрешениями.": "No individual rules. Addresses with granted permissions are selected.",
    "Список пуст. Ни один сайт не выбран.": "The list is empty. No sites are selected.",
    "Доступ к сайтам не выдан.": "No site access has been granted.",
    "Режим сохранён, исключения сохранены. Новые доступы не запрашивались. Примените изменения и перезагрузите страницы.": "Mode saved; exclusions kept. No new access was requested. Apply your changes and reload pages.",
    "Дождитесь загрузки списка сайтов.": "Wait for the site list to load.",
    "Доступ выдан. Адрес выбран в режиме всех доступных сайтов, если не исключён.": "Access granted. The address is selected in all-sites mode unless excluded.",
    "Доступ выдан. Сайт включается только отдельным правилом выбора.": "Access granted. A separate selection rule is required to enable this site.",
    "В доступе отказано. Список сайтов не изменён.": "Access denied. The site list was not changed.",
    "Исключение сохранено.": "Exclusion saved.",
    "Сайт выбран, доступ выдан. Примените профиль.": "Site selected and access granted. Apply your profile.",
    "Сайт выбран, но доступ не выдан. Подмены на нём не включены.": "Site selected, but access was not granted. Overrides are off for this site.",
    "На этой странице подмены недоступны.": "Overrides are unavailable on this page.",
    "Подменять на {0}": "Use overrides on {0}",
    "Этот тип страницы не поддерживается": "This page type is not supported",
    "Сайт остаётся исключённым. Проверьте список исключений в настройках.": "This site is still excluded. Check exclusions in settings.",
    "Сайт выбран. Примените профиль в настройках.": "Site selected. Apply your profile in settings.",
    "Сайт выбран, но в доступе отказано. Подмены не включены.": "Site selected, but access was denied. Overrides are off.",
    "Не удалось открыть настройки. Откройте их через меню расширений Chrome.": "Could not open settings. Open them from Chrome’s extensions menu.",
    "Проверка Chrome": "Chrome compatibility",
    "Перед первым применением загрузите полный отчёт проверки совместимости из Oboro Check. Он подтверждает работу расширения до запуска скриптов сайта в вашей версии Chrome. Ошибка или неполный отчёт оставляют подмены выключенными.": "Before applying for the first time, import a full compatibility report from Oboro Check. It verifies that the extension runs before site scripts in your Chrome version. Overrides remain off if the report fails or is incomplete.",
    "Отчёт проверки (JSON)": "Compatibility report (JSON)",
    "Проверить доступность механизмов": "Check available mechanisms",
    "Покрытие документов": "Document coverage",
    "Показаны только наблюдавшиеся документы. Диагностика не доказывает отсутствие всех утечек. Возврат из BFCache не применяет новую версию профиля.": "Only observed documents are shown. Diagnostics do not prove the absence of all leaks. Returning from BFCache does not apply a new profile revision.",
    "Workers: без базовой подмены.": "Workers: no baseline overrides.",
    "Dedicated, Shared и Service Workers сайта не покрыты. Непрозрачные about:blank/srcdoc/blob-контексты пропускаются, если HTTP/HTTPS-область не подтверждена.": "Site Dedicated, Shared and Service Workers are not covered. Opaque about:blank/srcdoc/blob contexts are skipped unless their HTTP/HTTPS scope is verified.",
    "Геонаблюдения останавливаются при уходе страницы. После возврата из кэша для их возобновления может понадобиться перезагрузка.": "Geolocation watches stop when the page is left. A reload may be needed to resume them after returning from cache.",
    "Технический отчёт документов и версий": "Technical document and revision report",
    "Настройки хранятся локально": "Settings are stored locally",
    "Нет подтверждения": "Not confirmed",
    "Установлено в документе": "Installed in document",
    "Не поддержано": "Not supported",
    "Покрытие ограничено": "Limited coverage",
    "Активный": "Active",
    "Неактивный; кэш не подтверждён": "Inactive; cache not confirmed",
    "Пререндер": "Prerender",
    "Установлен": "Installed",
    "Системный, подмена не запрошена": "Native; no override requested",
    "API отсутствует": "API unavailable",
    "Не поддержан": "Not supported",
    "Частично": "Partial",
    "Применение ещё не завершено: ожидается подтверждение документов или завершение очистки.": "Applying is not complete: waiting for document confirmation or cleanup.",
    "Регистрации пересобраны после обновления; проверяйте версии открытых документов.": "Registrations were rebuilt after an update; check the revisions of open documents.",
    "Восстановлена предыдущая конфигурация; нужны проверка и перезагрузка.": "The previous configuration was restored; verification and a reload are needed.",
    "Наблюдавшихся документов нет. Это не подтверждает покрытие всех вкладок и контекстов.": "No documents have been observed. This does not confirm coverage of all tabs and contexts.",
    "{0} · вкладка {1}, фрейм {2}": "{0} · tab {1}, frame {2}",
    "Последний снимок: ": "Last snapshot: ",
    "Документ ": "Document ",
    "Неизвестный lifecycle": "Unknown lifecycle",
    "Профиль: ": "Profile: ",
    "не подтверждён": "not confirmed",
    "не подтверждена": "not confirmed",
    "; ожидается ": "; expected ",
    ". Политика: ": ". Policy: ",
    "Геолокация": "Geolocation",
    "Время": "Time",
    "Снимок неактивного документа не подтверждает новую версию. Для удаления прежних обёрток вернитесь к нему и перезагрузите либо закройте вкладку.": "An inactive document snapshot does not confirm a new revision. Return to it and reload or close the tab to remove old wrappers.",
    "ожидается объект.": "expected an object.",
    "ожидается обычный объект данных.": "expected a plain data object.",
    "неизвестное поле.": "unknown field.",
    "ожидается непустая строка без управляющих символов.": "expected a non-empty string without control characters.",
    "значение не должно быть пустым.": "the value must not be empty.",
    "ожидается конечное число без преобразования из строки.": "expected a finite number without string conversion.",
    "число вне допустимого диапазона {0}…{1}.": "number outside the allowed range {0}…{1}.",
    "число вне допустимого диапазона ": "number outside the allowed range ",
    " (верхняя граница не включена)": " (upper bound excluded)",
    "число вне допустимого диапазона {0}…{1} (верхняя граница не включена).": "number outside the allowed range {0}…{1} (upper bound excluded).",
    "нужен языковой тег, поддерживаемый Intl, например de-DE или sr-Latn-RS.": "use a language tag supported by Intl, such as de-DE or sr-Latn-RS.",
    "нужен список из 1–{0} языковых тегов.": "enter a list of 1–{0} language tags.",
    "язык повторяется после нормализации.": "duplicate language after normalization.",
    "локаль не поддерживается форматированием дат или чисел в текущем окружении.": "the locale is not supported for date or number formatting in this environment.",
    "нужен именованный timezone ID, например Europe/Berlin или UTC.": "use a named time zone ID, such as Europe/Berlin or UTC.",
    "timezone ID не поддерживается текущим Intl.": "the time zone ID is not supported by this Intl implementation.",
    "длина имени не должна превышать 80 символов.": "the name must be no longer than 80 characters.",
    "выберите карту из каталога или системную карту без подмены.": "choose a map from the catalog or the system map without overrides.",
    "ожидается целое безопасное число от 0; 0 означает отсутствие профиля.": "expected a safe integer from 0; 0 means no profile.",
    "ожидается положительное безопасное целое число.": "expected a positive safe integer.",
    "версия схемы профиля не поддерживается.": "the profile schema version is not supported.",
    "language должен совпадать с первым каноническим элементом languages.": "language must match the first canonical element in languages.",
    "Профиль уже изменился. Прочитайте актуальную версию перед сохранением.": "The profile has changed. Load the current revision before saving.",
    "Не удалось прочитать сохранённый профиль.": "Could not read the saved profile.",
    "Сохранённый профиль повреждён или использует неподдерживаемую схему. Данные оставлены без изменений.": "The saved profile is damaged or uses an unsupported schema. Data has been kept unchanged.",
    "Достигнут предел revision; профиль не изменён.": "The revision limit was reached; the profile was not changed.",
    "Не удалось сохранить профиль. Результат записи нужно проверить повторным чтением.": "Could not save the profile. Read it again to verify the result.",
    "Фоновый процесс не ответил. Повторно прочитайте профиль перед сохранением.": "The background process did not respond. Read the profile again before saving.",
    "Получен некорректный ответ профиля.": "Received an invalid profile response.",
    "Ответ содержит некорректный профиль.": "The response contains an invalid profile.",
    "Сохранение не вернуло профиль.": "Saving did not return a profile.",
    "Ожидается объект правила или политики сайтов.": "Expected a site rule or policy object.",
    "Неизвестное поле политики сайтов.": "Unknown site policy field.",
    "Укажите точный хост без схемы, пути, порта и wildcard.": "Enter an exact host without a scheme, path, port or wildcard.",
    "Порты не входят в правила сайтов.": "Site rules do not include ports.",
    "Некорректный хост.": "Invalid host.",
    "Некорректный хост или явно заданный порт.": "Invalid host or an explicitly specified port.",
    "Флажок поддоменов должен быть boolean.": "The subdomains flag must be a boolean.",
    "Для IP-адреса поддомены не поддерживаются.": "Subdomains are not supported for IP addresses.",
    "Выберите HTTP, HTTPS или обе схемы без повторов.": "Choose HTTP, HTTPS or both without duplicates.",
    "Ожидается не более {0} правил в списке.": "Expected no more than {0} rules per list.",
    "Правило сайта повторяется.": "Duplicate site rule.",
    "Неизвестный режим выбора сайтов.": "Unknown site selection mode.",
    "Некорректная policyRevision.": "Invalid policyRevision.",
    "Неподдерживаемая схема или версия политики.": "Unsupported policy schema or revision.",
    "Фоновый процесс не вернул ответ.": "The background process did not return a response.",
    "Некорректный ответ фонового процесса.": "Invalid background process response.",
    "Команда доступна только интерфейсу расширения.": "This command is available only to the extension UI.",
    "Неизвестная команда.": "Unknown command.",
    "Не удалось выполнить команду.": "Could not complete the command.",
    "Конфигурация или доступы изменились во время применения.": "The configuration or access grants changed while applying.",
    "Запись состояния не подтверждена. Повторите проверку или отключение.": "Saving the state was not confirmed. Retry verification or disabling.",
    "Профиль, политика или доступы больше не совпадают со снимком.": "The profile, policy or access grants no longer match the snapshot.",
    "Для части выбранных правил доступ не выдан полностью.": "Some selected rules do not have all required access grants.",
    "Уже обработанные документы требуют перезагрузки; будущие подмены сняты.": "Processed documents need a reload; future overrides have been removed.",
    "Очистка не подтверждена; успешное отключение не объявлено.": "Cleanup is not confirmed; successful disabling has not been reported.",
    "Восстановленные регистрации не совпали.": "Restored registrations did not match.",
    "Предыдущая проверенная конфигурация восстановлена. Документам нужна повторная проверка или перезагрузка.": "The previous verified configuration was restored. Documents need verification or a reload.",
    "Фактические регистрации или DNR-правила изменились.": "The actual registrations or DNR rules changed.",
    "Не все документы подтвердили текущую версию; требуется проверка или перезагрузка.": "Not all documents confirmed the current revision; verification or a reload is required.",
    "Пересборка регистраций не подтверждена.": "Registration rebuild is not confirmed.",
    "Повреждено состояние применения.": "The activation state is damaged.",
    "Завершена прерванная очистка.": "Interrupted cleanup completed.",
    "Применение прервано до подтверждения регистраций.": "Applying was interrupted before registrations were confirmed.",
    "Журнал не совпадает с pending.": "The recovery journal does not match pending.",
    "Профиль отсутствует.": "No profile.",
    "Снимок не совпадает с committed.": "The snapshot does not match committed.",
    "Удалены регистрации без подтверждённой версии.": "Registrations without a confirmed revision were removed.",
    "Не удалось проверить оставшиеся регистрации. Настройки профиля доступны; применение не подтверждено.": "Could not verify remaining registrations. Profile settings are available; activation is not confirmed.",
    "Обновление расширения: ": "Extension update: ",
    "Повторная проверка незавершённой очистки.": "Rechecking unfinished cleanup.",
    "Регистрации или сетевые правила изменились.": "Registrations or network rules changed.",
    "Совместимость Chrome подтверждена отчётом Oboro Check. Можно применить профиль.": "Chrome compatibility was verified by an Oboro Check report. You can apply the profile.",
    "Будущие подмены отключены.": "Future overrides are off.",
    "Сначала сохраните региональный профиль.": "Save a regional profile first.",
    "Нет выбранных адресов с выданным доступом. Пустой список ничего не включает.": "No selected addresses have granted access. An empty list enables nothing.",
    "Импортируйте полный отчёт проверки совместимости для текущего Chrome. ": "Import a full compatibility report for the current Chrome version. ",
    "Регистрации или сетевые правила не подтвердились после применения.": "Registrations or network rules were not confirmed after applying.",
    "Очистка не подтверждена полностью: {0}": "Cleanup is not fully confirmed: {0}",
    "После очистки остались собственные регистрации или правила.": "Owned registrations or rules remain after cleanup.",
    "Не получены документы вкладки {0}.": "Could not get the documents in tab {0}.",
    "Выбранный iframe на другом сайте ожидает ручной перезагрузки страницы.": "A selected cross-site iframe needs a manual page reload.",
    "После перезапуска требуется новое наблюдение документа.": "A new document observation is required after restarting.",
    "Возвращён документ с прежними обёртками; подмены выключены или изменены.": "A document with old wrappers returned; overrides are disabled or have changed.",
    "Пререндер не подтверждён до активации документа.": "Prerender is not confirmed before document activation.",
    "Адрес {0} не имеет подтверждённой HTTP/HTTPS-области; подмена пропущена.": "Address {0} has no verified HTTP/HTTPS scope; overrides were skipped.",
    "Документ исключён правилом.": "The document is excluded by a rule.",
    "Документ не выбран текущим режимом.": "The document is not selected in the current mode.",
    "Сайт выбран, но host permission не выдан.": "The site is selected, but host permission has not been granted.",
    "Документ содержит прежнюю версию; возврат из BFCache не применяет новый профиль.": "The document contains an old revision; returning from BFCache does not apply a new profile.",
    "Ранняя установка и origin документа ещё не подтверждены.": "Early installation and the document origin are not yet confirmed.",
    "Навигация документа завершилась ошибкой; покрытие не подтверждено.": "Document navigation failed; coverage is not confirmed.",
    "Конфигурация изменилась; документ требует перезагрузки.": "The configuration changed; the document needs a reload.",
    "Нативный sender сообщает непрозрачный origin; API пропущены.": "The native sender reports an opaque origin; APIs were skipped.",
    "Версия или ранняя установка не совпадает; перезагрузите документ.": "The revision or early installation does not match; reload the document.",
    "Часть запрошенных модулей не установлена.": "Some requested modules are not installed.",
    "Модуль времени: ": "Time module: ",
    "Карта раскладки: ": "Keyboard map: ",
    "У части контекстов нет host permission; заголовки запросов могут остаться исходными.": "Some contexts lack host permission; request headers may remain unchanged.",
    "Кэшированный или неактивный документ содержит прежнюю версию. Вернитесь к нему и перезагрузите либо закройте вкладку.": "A cached or inactive document contains an old revision. Return to it and reload or close the tab.",
    "Наблюдения сохранены не полностью; отсутствие других пробелов покрытия не доказано.": "Not all observations were saved; other coverage gaps may exist.",
    "Некорректная запись восстановления.": "Invalid recovery record.",
    "Повреждена версия применения.": "Damaged activation revision.",
    "Повреждён снимок применения.": "Damaged activation snapshot.",
    "Повреждён журнал применения.": "Damaged recovery journal.",
    "Несогласованный журнал применения.": "Inconsistent recovery journal.",
    "Нужен полный JSON-отчёт проверки совместимости Oboro Check и точная версия текущего Chrome.": "A full Oboro Check compatibility JSON report and the exact current Chrome version are required.",
    "В отчёте нет исходного запуска без расширения.": "The report has no baseline run without the extension.",
    "В отчёте отсутствует запуск {0}.": "Run {0} is missing from the report.",
    "Проверки совместимости неполны, не пройдены или относятся к другой версии Chrome.": "Compatibility checks are incomplete, failed or belong to a different Chrome version.",
    "Нет подтверждения переключателя Allow User Scripts или завершённой очистки диагностической пробы.": "Allow User Scripts or complete diagnostic cleanup has not been confirmed.",
    "Изолированный диагностический канал": "Isolated diagnostics channel",
    "Реестр документов": "Document registry",
    "Недоступен {0}.": "Unavailable: {0}.",
    "Не получена точная версия Google Chrome.": "Could not obtain the exact Google Chrome version.",
    "Проверка совместимости Chrome": "Chrome compatibility check",
    "Проверка только на локальном стенде": "Local fixture checks only",
    "Обычная сборка расширения не участвует в этой пробе. Здесь устанавливаются MAIN-маркер и тестовый Accept-Language только для выбранных localhost-адресов. Языки браузера, время и геолокация не подменяются.": "The regular extension build is not involved in this probe. A MAIN marker and test Accept-Language are installed only for selected localhost addresses. Browser languages, time and geolocation are not overridden.",
    "Запустите": "Run",
    "и откройте четыре адреса стенда без установленной диагностической сборки. Сохраните серверный отчёт исходного запуска по инструкции.": "and open the four fixture addresses without the diagnostic build installed. Save the server baseline report as instructed.",
    "После установки этой сборки проверьте API с выключенным и включённым переключателем Chrome. Укажите наблюдаемое состояние ниже; после изменения переключателя обновите эту страницу.": "After installing this build, check the API with the Chrome toggle off and on. Record the observed state below; reload this page after changing the toggle.",
    "Подготовьте baseline, откройте все четыре ссылки, дождитесь записи наблюдений и соберите отчёт.": "Prepare a baseline, open all four links, wait for observations to be recorded and collect the report.",
    "Зарегистрируйте пробу, откройте четыре ссылки armed и соберите отчёт.": "Arm the probe, open the four armed links and collect the report.",
    "Снимите пробу, откройте четыре ссылки off и снова соберите отчёт. Экспортируйте JSON.": "Remove the probe, open the four off links and collect the report again. Export the JSON.",
    "Chrome 138+: «Allow User Scripts / Разрешить пользовательские скрипты» в сведениях о расширении; ранее — Developer mode. Этот инструмент не меняет переключатель Chrome и не использует позднюю инъекцию.": "Chrome 138+: enable “Allow User Scripts” in extension details; earlier versions use Developer mode. This tool does not change the Chrome toggle or use late injection.",
    "Проверки": "Checks",
    "Протокол нового baseline": "Protocol for new baseline",
    "HTTPS · 8788 (с вашим сертификатом)": "HTTPS · 8788 (with your certificate)",
    "Переключатель Chrome: наблюдение пользователя": "Chrome toggle: user observation",
    "Не проверено": "Not checked",
    "Исходный JSON, сохранённый без диагностической сборки": "Baseline JSON saved without the diagnostic build",
    "Проверить API": "Check APIs",
    "Подготовить baseline": "Prepare baseline",
    "Зарегистрировать пробу": "Arm probe",
    "Снять пробу": "Remove probe",
    "Собрать отчёт": "Collect report",
    "Экспортировать JSON": "Export JSON",
    "Наблюдаемый результат": "Observed result",
    "CONFIRMED появляется только при наличии исходного отчёта без диагностической сборки, проверок baseline/armed/off, одной точной версии Chrome и проверенного переключателя. NOT_RUN и INCOMPLETE не считаются успешным результатом.": "CONFIRMED requires a baseline report without the diagnostic build, baseline/armed/off checks, one exact Chrome version and a verified toggle. NOT_RUN and INCOMPLETE do not count as success.",
    "Проверка API…": "Checking APIs…",
    "Серверный отчёт: HTTP {0}": "Server report: HTTP {0}",
    "На локальном адресе не найден сервер Oboro Check. Запустите npm run fixture.": "No Oboro Check server found at the local address. Run npm run fixture.",
    "API проверены. Успешная регистрация и наблюдения страниц проверяются отдельно.": "APIs checked. Successful registration and page observations are checked separately.",
    "Не удалось снять сетевые правила: {0}": "Could not remove network rules: {0}",
    "Исходный запуск подготовлен. Откройте все четыре ссылки baseline и дождитесь записи наблюдений на каждой странице. Если расширение ещё не установлено, исходный запуск можно открыть с обычной страницы стенда по инструкции.": "Baseline prepared. Open all four baseline links and wait for observations on each page. If the extension is not installed yet, follow the instructions to open the baseline from the regular fixture page.",
    "Сначала подготовьте исходный запуск и соберите наблюдения baseline.": "Prepare the baseline and collect baseline observations first.",
    "Исходный запуск: {0}. Откройте все страницы baseline и соберите отчёт.": "Baseline: {0}. Open all baseline pages and collect the report.",
    "Проба зарегистрирована до навигации. Откройте все четыре ссылки armed. Доступность API ещё не означает, что проверка пройдена.": "The probe was registered before navigation. Open all four armed links. API availability alone does not mean the checks passed.",
    "Очистка не подтверждена полностью: {0}. Проверьте ссылки off после перезагрузки страниц.": "Cleanup is not fully confirmed: {0}. Check the off links after reloading the pages.",
    "Регистрации и правила сняты. Откройте четыре ссылки off: уже открытые документы требуют новой загрузки.": "Registrations and rules removed. Open the four off links: existing documents need a new load.",
    "Результат: {0}. Подробности и недостающие проверки приведены ниже.": "Result: {0}. See details and missing checks below.",
    "JSON сформирован и передан браузеру для скачивания.": "JSON created and sent to the browser for download.",
    "Исходный отчёт слишком велик: максимум 512 КБ.": "The baseline report is too large: maximum 512 KB.",
    "В исходном отчёте нет runId.": "The baseline report has no runId.",
    "Исходный отчёт без расширения: {0}. Нужны все четыре хоста, iframe и точная версия Chrome.": "Baseline without extension: {0}. All four hosts, iframes and the exact Chrome version are required.",
    "Исходный отчёт, указанный вами как снятый без диагностической сборки, добавлен в результаты.": "The baseline report you identified as captured without the diagnostic build has been added to the results.",
    "API проверены вызовами из установленного расширения. Прочитайте результат, затем подготовьте исходный запуск.": "APIs checked by calls from the installed extension. Read the result, then prepare the baseline.",
    "Участвует в пробе": "Included in probe",
    "Не выбран": "Not selected",
    "Исключён из пробы": "Excluded from probe",
    "Контрольный хост": "Control host",
    "Выбранный сайт": "Selected site",
    "Выбранный поддомен": "Selected subdomain",
    "Исключённый поддомен": "Excluded subdomain",
    "Посторонний сайт": "Unrelated site",
    "Региональный профиль изменён. Примените новую версию.": "The regional profile changed. Apply the new revision.",
    "Список сайтов изменён. Примените новую политику.": "The site list changed. Apply the new policy.",
    "Не удалось прочитать состояние расширения. Перезагрузите расширение.": "Could not read the extension state. Reload the extension.",
    "Вкладка не относится к обрабатываемым документам.": "This tab does not belong to the processed documents.",
    "Доступы Chrome изменились. Примените профиль повторно.": "Chrome access grants changed. Apply the profile again.",
    "Профиль или политика изменены; требуется повторное применение.": "The profile or policy changed; apply again.",
    "Не удалось обработать запрос профиля.": "Could not process the profile request.",
    "Профиль доступен только интерфейсу этого расширения.": "The profile is available only to this extension’s UI.",
    "Неизвестная операция или поля запроса профиля.": "Unknown profile operation or request fields.",
    "Слишком много пересечений правил и доступов; сократите список сайтов.": "Too many rule and access intersections; reduce the site list.",
    "Геолокация доступна только при наличии нативного API в secure context.": "Geolocation requires the native API in a secure context.",
    "Нативные методы геолокации недоступны для переопределения.": "Native geolocation methods cannot be overridden.",
    "Keyboard Map API недоступен; карта раскладки не подменена.": "Keyboard Map API unavailable; the keyboard map was not overridden.",
    "Карта раскладки требует безопасного контекста.": "The keyboard map requires a secure context.",
    "Permissions Policy запрещает keyboard-map; нативный отказ сохранён.": "Permissions Policy blocks keyboard-map; the native denial was preserved.",
    "События Keyboard API не поддержаны.": "Keyboard API events are not supported.",
    "KeyboardLayoutMap не поддерживает проверенный maplike-контракт.": "KeyboardLayoutMap does not support the verified maplike contract.",
    "Нельзя переопределить Keyboard API: ": "Cannot override Keyboard API: ",
    "KeyboardLayoutMap не поддерживает ": "KeyboardLayoutMap does not support ",
    "Требуется один аргумент KeyboardLayoutMap.": "One KeyboardLayoutMap argument is required.",
    "Callback должен быть функцией.": "The callback must be a function.",
    "Метод Keyboard.getLayoutMap недоступен.": "Keyboard.getLayoutMap is unavailable.",
    "Не удалось откатить Keyboard API; перезагрузите документ.": "Could not roll back Keyboard API; reload the document.",
    "Ошибка карты раскладки.": "Keyboard map error.",
    "Свойства языка браузера недоступны для переопределения.": "Browser language properties cannot be overridden.",
    "Недоступен метод форматирования: ": "Formatting method unavailable: ",
    "Недоступен метод времени: ": "Time method unavailable: ",
    "Отсутствует Date.": "Date is unavailable.",
    "Документ содержит прежнюю версию. Перезагрузите страницу для применения изменений.": "The document contains an old revision. Reload the page to apply changes.",
    "Ранняя установка пропущена. Поздняя подмена не выполняется; перезагрузите документ.": "Early installation was missed. Late overrides are not performed; reload the document.",
    "Ошибка языкового модуля.": "Language module error.",
    "Ошибка геолокации.": "Geolocation error.",
    "Temporal присутствует без поддерживаемого Temporal.Now.": "Temporal is present without a supported Temporal.Now.",
    "Версия Temporal.Now не поддерживает проверенный набор методов.": "This Temporal.Now version does not support the verified method set.",
    "Temporal.Now.timeZoneId нельзя переопределить.": "Temporal.Now.timeZoneId cannot be overridden.",
    "Метод Temporal.Now.": "Method Temporal.Now.",
    " нельзя переопределить.": " cannot be overridden.",
    "Ошибка установки Temporal.Now.": "Temporal.Now installation error.",
    "Абсолютные Date API изменились.": "Absolute Date APIs changed.",
    "Сериализация или timestamp Date изменились.": "Date serialization or timestamp changed.",
    "Изменён Date.": "Date changed.",
    "Изменён performance.now.": "performance.now changed.",
    "Локальные поля Date не совпадают с профилем.": "Local Date fields do not match the profile.",
    "Изменён instant Date.": "The Date instant changed.",
    "Конструктор Date использует другую timezone.": "The Date constructor uses a different time zone.",
    "Date.parse изменил явный UTC.": "Date.parse changed explicit UTC.",
    "Setter Date не согласован с календарём.": "The Date setter is inconsistent with the calendar.",
    "Intl defaults не совпадают с профилем.": "Intl defaults do not match the profile.",
    "Intl форматирует в другой зоне.": "Intl formats in a different zone.",
    "Изменена явная UTC zone.": "The explicit UTC zone changed.",
    "Date.toLocaleString не согласован с Intl.": "Date.toLocaleString is inconsistent with Intl.",
    "JSON Date не сохраняет instant/Invalid Date.": "JSON Date does not preserve the instant/Invalid Date.",
    "Изменена Invalid Date.": "Invalid Date changed.",
    "structuredClone присутствует без функции.": "structuredClone is present but is not a function.",
    "structuredClone изменил timestamp.": "structuredClone changed the timestamp.",
    "structuredClone использует другой realm Date.": "structuredClone uses a different Date realm.",
    "structuredClone изменил Invalid Date.": "structuredClone changed Invalid Date.",
    "structuredClone был подменён.": "structuredClone was overridden.",
    "Temporal.Now не установлен.": "Temporal.Now is not installed.",
    "Изменён Temporal.Now.instant.": "Temporal.Now.instant changed.",
    "Temporal.Now использует системную зону.": "Temporal.Now uses the system zone.",
    "Temporal.Now.zonedDateTimeISO возвращает другую именованную зону.": "Temporal.Now.zonedDateTimeISO returns a different named zone.",
    "Temporal.Now изменил instant.": "Temporal.Now changed the instant.",
    "Temporal.Now.plainDateTimeISO не согласован с зоной.": "Temporal.Now.plainDateTimeISO is inconsistent with the zone.",
    "Temporal.Now.plainDateISO не согласован с зоной.": "Temporal.Now.plainDateISO is inconsistent with the zone.",
    "Temporal.Now.plainTimeISO не согласован с зоной.": "Temporal.Now.plainTimeISO is inconsistent with the zone.",
    "Temporal.Now изменил явную UTC zone.": "Temporal.Now changed the explicit UTC zone.",
    "Date/Intl/Temporal используют разные зоны.": "Date/Intl/Temporal use different zones.",
    "Temporal.Now не поддержан.": "Temporal.Now is not supported.",
    "Ошибка модуля времени.": "Time module error.",
    "Откат времени не завершён; перезагрузите документ.": "Time rollback is incomplete; reload the document.",
    "Ошибка locale.": "Locale error.",
    "Неизвестное действие с сайтом.": "Unknown site action.",
    "Список сайтов изменился. Обновите его перед сохранением.": "The site list changed. Refresh it before saving.",
    "Достигнут предел версии политики.": "The policy revision limit was reached.",
    "Запуск остановлен: нужны доступы к стенду, userScripts и DNR. Проверьте отчёт API и переключатель Chrome, затем обновите эту страницу.": "Run stopped: fixture access, userScripts and DNR are required. Check the API report and Chrome toggle, then reload this page.",
    "Не удалось снять предыдущую пробу: {0}": "Could not remove the previous probe: {0}",
    "Регистрации и сетевые правила не подтвердились после записи.": "Registrations and network rules were not confirmed after saving.",
    " Откат: ": " Rollback: "
  });

  const key = "oboro.language";
  const root = document.documentElement;
  /** @type {Storage | undefined} */
  let storage;
  /** @param {unknown} value @returns {"en" | "ru"} */
  const normalize = (value) => value === "ru" ? "ru" : "en";
  let language = "en";
  try { storage = window.localStorage; language = normalize(storage.getItem(key)); } catch { /* English remains available without storage. */ }
  root.lang = language;
  /** @type {WeakMap<Element, {source: string, values: readonly unknown[]}>} */
  const dynamic = new WeakMap();
  /** @param {string} value */
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const entries = Object.entries(messages).sort((a, b) => b[0].length - a[0].length);
  const patterns = entries.filter(([source]) => /\{\d+\}/.test(source)).map(([source, english]) => {
    const slots = [...source.matchAll(/\{(\d+)\}/g)].map((match) => Number(match[1]));
    return { pattern: new RegExp("^" + source.split(/\{\d+\}/).map(escape).join("([\\s\\S]*?)") + "$"), english, slots };
  });
  const fragments = new RegExp(entries.filter(([source]) => !/\{\d+\}/.test(source)).map(([source]) => escape(source)).join("|"), "g");
  /** @param {string} source @param {readonly unknown[]} values */
  const format = (source, values) => source.replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)] ?? ""));
  /** @param {string} source @param {...unknown} values @returns {string} */
  function translate(source, ...values) {
    if (language === "ru") return values.length ? format(source, values) : source;
    if (Object.hasOwn(messages, source)) return values.length ? format(messages[source] ?? source, values) : messages[source] ?? source;
    if (values.length) return format(source.replace(fragments, (part) => messages[part] ?? part), values);
    if (source.includes("\n")) return source.split("\n").map((line) => translate(line)).join("\n");
    // Runtime reasons originate in the worker. Localize their display without
    // importing UI state into stored reports or the site's execution context.
    for (const { pattern, english, slots } of patterns) {
      const match = source.match(pattern);
      if (match) {
        const captured = [];
        for (const [index, slot] of slots.entries()) captured[slot] = match[index + 1]?.replace(fragments, (part) => messages[part] ?? part);
        return format(english, captured);
      }
    }
    return source.replace(fragments, (part) => messages[part] ?? part);
  }
  /** @param {Element} element @param {string} source @param {...unknown} values */
  function setText(element, source, ...values) {
    element.removeAttribute("data-i18n");
    element.setAttribute("data-i18n-dynamic", "");
    dynamic.set(element, { source, values });
    const value = translate(source, ...values);
    if (element.textContent !== value) element.textContent = value;
  }
  /** @param {Element} element @param {string} value */
  function setPlainText(element, value) {
    element.removeAttribute("data-i18n");
    element.removeAttribute("data-i18n-dynamic");
    dynamic.delete(element);
    element.textContent = value;
  }
  /** @param {ParentNode} parent */
  function localize(parent) {
    for (const element of parent.querySelectorAll("[data-i18n]")) {
      const value = translate(element.getAttribute("data-i18n") ?? "");
      if (element.textContent !== value) element.textContent = value;
    }
    for (const element of parent.querySelectorAll("[data-i18n-placeholder]")) {
      const value = translate(element.getAttribute("data-i18n-placeholder") ?? "");
      if (element.getAttribute("placeholder") !== value) element.setAttribute("placeholder", value);
    }
    for (const element of parent.querySelectorAll("[data-i18n-dynamic]")) {
      const message = dynamic.get(element);
      if (message) {
        const value = translate(message.source, ...message.values);
        if (element.textContent !== value) element.textContent = value;
      }
    }
  }
  const controls = () => document.querySelectorAll("select[data-language-select]");
  const feedback = () => document.querySelectorAll("[data-language-feedback]");
  const apply = () => {
    root.lang = language;
    for (const control of controls()) if (control instanceof HTMLSelectElement) control.value = language;
    localize(document);
  };
  // A single bootstrap owns all translations, even though page modules bundle
  // independently. WeakMap entries do not retain removed diagnostic cards.
  Object.defineProperty(window, "oboroI18n", { value: Object.freeze({ translate, setText, setPlainText }) });
  const mount = () => {
    apply();
    for (const control of controls()) control.addEventListener("change", () => {
      if (!(control instanceof HTMLSelectElement)) return;
      language = normalize(control.value);
      apply();
      let saved = false;
      try { if (storage) { storage.setItem(key, language); saved = true; } } catch { /* Keep this window usable. */ }
      for (const message of feedback()) {
        setText(message, saved ? "" : "Язык изменён для этого окна. Не удалось сохранить выбор.");
        if (message instanceof HTMLElement) message.hidden = saved;
      }
    });
  };
  // Observe only explicitly marked UI nodes; user names, form values and raw
  // JSON are never inferred as messages or translated by this observer.
  new MutationObserver(() => localize(document)).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-i18n", "data-i18n-placeholder"] });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
  window.addEventListener("storage", (event) => {
    if (!storage || event.storageArea !== storage || (event.key !== key && event.key !== null)) return;
    language = normalize(event.key === null ? null : event.newValue);
    apply();
    for (const message of feedback()) { setText(message, ""); if (message instanceof HTMLElement) message.hidden = true; }
  });
})();
