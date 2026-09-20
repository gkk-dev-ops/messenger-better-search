# Messenger Better Search

> **Czy też masz problem z odnalezieniem czegoś w starej konwersacji na Messengerze?**

Pamiętasz, że ktoś coś Ci wysłał albo o czymś rozmawialiście, ale natywne wyszukiwanie Messengera nie pomaga? Messenger Better Search tworzy lokalny, przeszukiwalny indeks historii rozmów z **eksportu Meta**.

Nie logujemy się do Messengera za Ciebie, nie przewijamy automatycznie rozmów i nie importujemy wiadomości z DOM. Źródłem historii jest plik, który użytkownik sam pobiera przez **Meta Export Your Information**.

**Local-first. Open source. Bring your own key for optional AI.**

Messenger Better Search powstaje jako open-source project by [GKD](https://gkd.agency).

## Download

Gotowe paczki rozszerzenia są publikowane w [GitHub Releases](https://github.com/gkk-dev-ops/messenger-better-search/releases/latest).

1. Pobierz ZIP najnowszej wersji.
2. Rozpakuj go.
3. Otwórz `chrome://extensions`.
4. Włącz **Developer mode**.
5. Kliknij **Load unpacked** i wskaż rozpakowany katalog.

## Jak to działa

### 1. Eksportujesz historię przez Meta

W Meta Accounts Center wybierasz **Export Your Information**, zaznaczasz **Messages**, format **JSON** i eksport do urządzenia.

Możesz zrobić:

- pełny eksport historii przy pierwszym imporcie,
- później mniejsze eksporty tylko za kolejny okres.

### 2. Importujesz ZIP lub JSON do Better Search

Rozszerzenie:

- odczytuje pliki `message_*.json`,
- rozpoznaje rozmowy i uczestników,
- normalizuje wiadomości, reakcje, połączenia i załączniki,
- deduplikuje kolejne importy,
- zapisuje indeks lokalnie w IndexedDB,
- nie wymaga wysyłania archiwum do żadnego backendu.

Możesz importować kilka części eksportu jednocześnie.

### 3. Przeszukujesz lokalne archiwum

Możesz:

- wyszukiwać tekst,
- filtrować po rozmowie i dacie,
- przeszukiwać wszystkie rozmowy naraz,
- grupować wyniki po dniach, tygodniach, miesiącach i latach,
- wejść w szerszy kontekst znalezionej wiadomości.

### 4. Opcjonalny bridge w Messengerze

Gdy korzystasz z natywnego **Search in conversation**, extension może dodać przycisk:

> **Open in Better Search**

Przycisk przekazuje wyłącznie wpisane przez Ciebie query do lokalnego Better Search.

Bridge:

- nie czyta wyników wyszukiwania Messengera,
- nie importuje wiadomości z DOM,
- nie przechwytuje historii rozmowy,
- nie pobiera mediów z CDN Messengera.

## Dlaczego

Zamiast pamiętać dokładne słowa możesz później szukać kontekstu, np.:

- „ten soft flask, do którego miałem wydrukować stojak”,
- „kod SMS, który dostałem w maju”,
- „kiedy rozmawialiśmy o locie do Włoch?”,
- „co ustaliliśmy w tamtym tygodniu?”.

## Importy przyrostowe

Po pierwszym pełnym imporcie nie musisz za każdym razem eksportować całej historii.

Przykładowo:

```text
pełny eksport do 1 września
+
eksport 1–30 września
=
zaktualizowane lokalne archiwum
```

Messenger Better Search rozpoznaje wiadomości, które już istnieją, i pomija duplikaty.

## AI / BYOK

Podstawowy import i wyszukiwanie nie wymagają AI ani klucza API.

Opcjonalne rozszerzenia:

| Funkcja | Provider | Bez klucza |
| --- | --- | --- |
| Text search | lokalnie | ✅ |
| Filtrowanie i grupowanie czasu | lokalnie | ✅ |
| Import / deduplikacja | lokalnie | ✅ |
| Voice transcription | ElevenLabs Scribe | ❌ |
| Image/OCR context | model vision | ❌ |
| Semantic search | embeddings | ❌ |
| Group analysis | model tekstowy | ❌ |

Klucze są przechowywane w `chrome.storage.local` profilu przeglądarki. Nie są wysyłane do żadnego backendu projektu.

> Browser extension storage nie powinien być traktowany jak sejf na sekrety wysokiej wartości. Docelowo chcemy wspierać również klucze sesyjne i lokalne modele.

## Prywatność

Projekt nie ma backendu zbierającego historię rozmów.

Standardowy flow:

```text
Meta Export ZIP / JSON
        ↓
Messenger Better Search
        ↓
IndexedDB w Twojej przeglądarce
        ↓
lokalne wyszukiwanie
```

Dane opuszczają urządzenie tylko wtedy, gdy użytkownik świadomie włączy konkretną integrację AI wymagającą zewnętrznego providera.

Zobacz [Privacy & threat model](docs/privacy.md).

## Development

```bash
git clone https://github.com/gkk-dev-ops/messenger-better-search.git
cd messenger-better-search
npm install
npm test
npm run build
npm run test:e2e
```

Playwright testuje m.in.:

- import Meta ZIP,
- ponowny import i deduplikację,
- wyszukiwanie zaimportowanej wiadomości,
- odrzucenie eksportu HTML,
- wstrzyknięcie przycisku **Open in Better Search** do fixture natywnego search UI Messengera,
- przekazanie wyłącznie query do lokalnego Better Search.

## CI / release

GitHub Actions uruchamia unit/integration tests, buduje extension, wykonuje Playwright E2E, tworzy ZIP oraz publikuje artefakty. Pipeline release jest blokowany, jeśli testy lub E2E nie przejdą.

Publikacja do Chrome Web Store pozostaje obecnie mockiem do czasu skonfigurowania danych aplikacji i sekretów Store.

## Status

To wczesna wersja produktu. Format eksportów Meta może ewoluować, dlatego parser jest testowany niezależnie i toleruje różne ścieżki/fragmenty archiwum.

Integracja z UI Messengera jest celowo minimalna: wykrywa wyłącznie pole **Search in conversation** i dodaje shortcut do Better Search. Jeśli Meta zmieni ten fragment UI, bridge może wymagać aktualizacji, ale import archiwum i lokalny search pozostają niezależne.

## License

MIT
