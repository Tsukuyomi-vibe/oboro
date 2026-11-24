# Региональный профиль I03

Код модели, валидации, репозитория и API реализован. На момент завершения I03 `npm run check` проходил: типы, обычная/диагностическая сборки и 36 тестов, из них 21 тест I03. После согласованного I04–I10 полный набор составляет 78 тестов; текущая интеграция описана в [руководстве](i04-i10-implementation.md). Сохранение и повторное чтение после пересоздания репозитория проверены с JSON-хранилищем и тестовым транспортом Chrome. Реальный перезапуск Chrome и визуальная приёмка настроек пока не проверены.

## Модель

`RegionalProfile` — один сохранённый профиль для всех будущих выбранных сайтов. Поля:

| Поле | Правило |
| --- | --- |
| `schemaVersion` | Сейчас только `1`; неизвестная версия не мигрируется и не перезаписывается автоматически |
| `revision` | Положительное безопасное целое; назначается репозиторием, первая запись получает `1` |
| `name` | Непустая строка до 80 символов; пробелы по краям убираются, управляющие символы запрещены |
| `geolocation.latitude` | Конечное число от −90 до 90 включительно |
| `geolocation.longitude` | Конечное число от −180 до 180 включительно |
| `geolocation.accuracy` | Конечное неотрицательное число, метры; обязательное поле |
| `geolocation.altitude` | Конечное число, в том числе отрицательное, или `null`; метры |
| `geolocation.altitudeAccuracy` | Конечное неотрицательное число или `null`; метры |
| `geolocation.speed` | Конечное неотрицательное число или `null`; метры в секунду |
| `geolocation.heading` | Конечное число в диапазоне `[0, 360)` или `null`; градусы |
| `languages` | От 1 до 10 тегов, порядок предпочтений; без повторов после нормализации |
| `language` | Производное поле, равное первому каноническому элементу `languages` |
| `locale` | Канонический тег, поддерживаемый текущими `Intl.DateTimeFormat` и `Intl.NumberFormat` |
| `timeZone` | Именованный ID, принимаемый текущим `Intl.DateTimeFormat`, например `Europe/Berlin` или `UTC` |
| `keyboardLayout` (с I19) | native, us-qwerty, de-qwertz или ru-jcuken; отсутствие в прежней схеме v1 читается как native без перезаписи |

Отсутствующие или явно неизвестные `altitude`, `altitudeAccuracy`, `speed`, `heading` нормализуются в `null`. Строки с числами, NaN, ±Infinity, boolean и объекты в числовых полях отвергаются; −0 нормализуется в 0. Неизвестные поля, включая опечатки и отдельный `utcOffset`/`timezoneOffset`, отвергаются.

Языки нормализуются через `Intl.getCanonicalLocales`. Поддерживается набор языковых тегов, который принимает Intl; wildcard, private-use-only и некоторые исторические теги вне этого набора отвергаются. Управляющие символы, CRLF и готовые HTTP-фрагменты вроде `en-US;q=0.9` не принимаются. Locale независима от языка интерфейса; координаты не используются для автоматического выбора языка или timezone. Основание правил Intl: [ECMA-402](https://tc39.es/ecma402/#sec-canonicalizelocalelist).

Часовой пояс сохраняется как поддерживаемая именованная строка, включая допустимые алиасы. Он не заменяется численным смещением. Строки `+03:00`/`−05:00` не являются допустимыми значениями этой модели. Значение `Etc/GMT+3` допустимо как именованная зона IANA. Вычисления календаря и DST относятся к I13–I18.

Диапазоны и единицы геополей согласованы с моделью [Geolocation](https://www.w3.org/TR/geolocation/#geolocationcoordinates_interface). Генерация позиции, ошибок и наблюдения за координатами реализуется в I10/I11; в I03 эти API страниц не меняются. Карта раскладки и форма редактирования добавлены в [I19–I20](i19-i20-implementation.md); дополнительные геополя в форме можно оставить пустыми для null.

## Сохранение и согласованность

Ключ `chrome.storage.local`: **`regionalProfile`**. Профиль, schemaVersion и revision записываются одним объектом. На установке и обновлении пример автоматически не сохраняется. `load()` возвращает `null`, если ключ отсутствует. Другие настройки не изменяются. Хранение соответствует назначению [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage).

`ProfileRepository` создаётся один раз в service worker. Все обращения UI проходят через этот экземпляр; очередь сериализует операции. `save(draft, expectedRevision)` требует `0` для создания или актуальную revision для изменения. Устаревшая версия вызывает `REVISION_CONFLICT`, новая запись не выполняется. Сохранение эквивалентного нормализованного содержимого не меняет revision. После ошибки очередь продолжает работать; переполнение безопасного целого запрещено.

Профиль при чтении проходит повторную валидацию. Неизвестная схема и повреждённые данные возвращают `INVALID_STORED_PROFILE` без очистки или замены содержимого. Ошибка записи возвращает `STORAGE_WRITE_FAILED`; если подтверждение потерялось после записи, актуальное состояние выясняется через `load()`, а не повторным слепым сохранением. Восстановление прерванного применения подмен относится к I21.

Публичные функции: `loadProfile()`, `saveProfile(draft, expectedRevision)`, `profileToDraft(profile)`, `parseProfileDraft(value)`, `parseRegionalProfile(value)`, `compileRegionalProfile(profile)` и `compileAcceptLanguage(languages)`. Клиентская валидация выполняется до сериализации сообщения: [Chrome messaging использует JSON](https://developer.chrome.com/docs/extensions/develop/concepts/messaging#serialization), который иначе мог бы заменить NaN/Infinity на null. Service worker повторно проверяет вход и принимает запросы только от собственного popup/options. Репозиторий не следует создавать в другом контексте для параллельной записи; остальные модули используют клиент API или экземпляр владельца в service worker.

Модель и возвращаемые снимки неизменяемы: объект, языковой массив и геополя заморожены и отделены от входных данных. `compileRegionalProfile` возвращает `{ profile, acceptLanguage }` для одной revision.

## Accept-Language

Заголовок строится только из списка languages, без добавления невыбранных языков и автоматических базовых fallback. Первый язык имеет неявный вес 1, следующие — `0.9`, `0.8`, …, `0.1`. Ограничение десятью языками сохраняет положительные различающиеся веса. Числа формируются без дробных погрешностей и не зависят от locale. Правила весов: [RFC 9110, Quality Values](https://www.rfc-editor.org/rfc/rfc9110.html#name-quality-values).

```text
["de-DE", "de", "en-US"]
→ de-DE,de;q=0.9,en-US;q=0.8
```

Компиляция только возвращает строку. Сетевые правила для реальных выбранных сайтов относятся к I07 и здесь не устанавливаются.

## Ручная приёмка в Chrome

1. Выполнить `npm run check` и загрузить/перезагрузить обычную папку `dist` в Chrome. Диагностическая `dist-probe` использует своё хранилище и для этой проверки не подходит.
2. На чистой установке открыть настройки. Ожидаются «Профиль ещё не сохранён», выключенный общий выключатель и общий статус «Не настроено».
3. В DevTools **страницы настроек самого расширения** выполнить следующий код. В коде `expectedRevision: 0` не позволяет перезаписать уже существующий профиль:

```javascript
var region = await import(chrome.runtime.getURL("profile/profile-api.js"));
await region.loadProfile(); // null на чистой установке
var saved = await region.saveProfile(region.getExampleProfileDraft(), 0);
({ revision: saved.revision, language: saved.language, first: saved.languages[0] });
// revision: 1, language и first: "de-DE"
region.compileRegionalProfile(saved).acceptLanguage;
// "de-DE,de;q=0.9,en-US;q=0.8"
```

4. Проверить, что блок настроек показывает «Берлин», языки, locale, timezone, координаты и точность. Общий статус подмен остаётся «Не настроено»: сайтами и применением профиля этот шаг ещё не управляет.
5. Закрыть страницу, перезагрузить расширение через `chrome://extensions` и заново открыть настройки. Затем отдельно полностью перезапустить Chrome и снова открыть настройки. Повторно импортировать API в DevTools и прочитать профиль:

```javascript
var region = await import(chrome.runtime.getURL("profile/profile-api.js"));
var current = await region.loadProfile();
({ name: current.name, revision: current.revision, language: current.language, languages: current.languages });
// Тот же профиль, revision: 1.
```

6. Проверить ошибку до записи и сохранность revision:

```javascript
var invalid = { ...region.getExampleProfileDraft(), geolocation: { latitude: 91, longitude: 13.405, accuracy: 1000 } };
await region.saveProfile(invalid, current.revision); // ProfileValidationError
(await region.loadProfile()).revision; // 1
```

7. Сохранить изменённое имя с актуальной revision, затем попробовать повтор с устаревшей:

```javascript
await region.saveProfile({ ...region.profileToDraft(current), name: "Берлин — проверка" }, current.revision);
// revision: 2
await region.saveProfile(region.getExampleProfileDraft(), current.revision);
// ProfileClientError, detail.code: "REVISION_CONFLICT", actualRevision: 2
```

8. Записать точную версию Chrome и наблюдаемый результат перезапуска в журнал. Версию можно получить на `chrome://version`. Автоматизированные тесты используют тестовый адаптер, поэтому этот браузерный пункт пока остаётся открытым.

`profile/profile-api.js` не объявлен web-accessible resource и предназначен для собственного UI/DevTools расширения. Пример [berlin.regional-profile.json](../examples/berlin.regional-profile.json) — демонстрационный снимок; перед сохранением его системные поля удаляет `profileToDraft`, а актуальную revision назначает репозиторий.
