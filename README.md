# Messenger Better Search

> **Czy też masz problem z szukaniem w konwersacjach w Messengerze?**

Pamiętasz, że ktoś coś Ci napisał, ale nie możesz już znaleźć gdzie? Messenger Better Search jest open-source'owym rozszerzeniem, które pozwala odzyskać kontrolę nad własną historią rozmów: zebrać ją lokalnie, pogrupować, przeszukiwać i — opcjonalnie, z własnym kluczem API — wzbogacić o transkrypcje, opisy obrazów i wyszukiwanie semantyczne.

**Twoje dane domyślnie zostają u Ciebie. Bring your own key.**

Messenger Better Search powstaje jako open-source project by GKD.

## Co robi

- zbiera tekst z otwartej rozmowy Messenger,
- przewija historię wstecz do wybranej daty,
- pokazuje **aktualnie osiągniętą datę** i cel,
- zapisuje checkpointy oraz powód zatrzymania,
- pozwala wznowić capture po błędzie/reloadzie,
- przechowuje dane w IndexedDB rozszerzenia,
- wyszukuje po tekście lokalnie,
- grupuje wyniki po dniach, tygodniach, miesiącach i latach,
- opcjonalnie transkrybuje głosówki przez ElevenLabs Scribe,
- opcjonalnie opisuje zdjęcia + widoczny tekst przez model vision,
- opcjonalnie tworzy embeddings i semantic search,
- opcjonalnie streszcza wybrany dzień/tydzień/miesiąc/rok.

## Dlaczego

Z filmów, wiadomości, zdjęć i głosówek rozproszonych w Messengerze tworzymy prywatne, możliwe do przeszukania archiwum w Twojej przeglądarce. Zamiast pamiętać dokładne słowa możesz później szukać kontekstu:

- „ten soft flask, do którego miałem wydrukować stojak”,
- „kod SMS, który dostałem w maju”,
- „kiedy rozmawialiśmy o locie do Włoch?”,
- „co ustaliliśmy w tym tygodniu?”.

## Background capture — co jest możliwe

Capture nie zależy od popupu rozszerzenia. Silnik działa jako **content script w karcie Messengera**, a zapis i stan sesji obsługuje service worker rozszerzenia.

To oznacza, że możesz przełączyć się na inną kartę i capture może dalej przewijać Messenger oraz zapisywać kolejne partie danych.

Istnieje ważne ograniczenie platformy: Chrome może ograniczyć działanie ukrytej karty albo całkowicie ją **discardować/reloadować**, szczególnie przy presji pamięci. Service worker ani offscreen document nie mają dostępu do DOM Messengera, więc nie możemy kontynuować scrollowania po usunięciu dokumentu strony.

Dlatego Messenger Better Search zapisuje:

- ostatnią osiągniętą datę,
- target date,
- status,
- powód przerwania,
- timestamp checkpointu.

Po ponownym otwarciu karty użyj **Resume from checkpoint**.

## Instalacja lokalna

```bash
git clone https://github.com/gkk-dev-ops/messenger-better-search.git
cd messenger-better-search
npm run build
```

1. Otwórz `chrome://extensions`.
2. Włącz Developer mode.
3. Kliknij **Load unpacked**.
4. Wskaż katalog `dist/`.
5. Otwórz rozmowę w Messengerze.
6. Ustaw datę i uruchom capture.

## AI / BYOK

Wszystkie funkcje AI są opcjonalne.

| Funkcja | Provider w MVP | Bez klucza |
| --- | --- | --- |
| Text search | lokalnie | ✅ |
| Grupowanie czasu | lokalnie | ✅ |
| Voice transcription | ElevenLabs Scribe v2 | ❌ |
| Image/OCR context | OpenAI vision | ❌ |
| Semantic search | OpenAI embeddings | ❌ |
| Group analysis | OpenAI text model | ❌ |

Klucze są przechowywane w `chrome.storage.local` Twojego profilu przeglądarki. Nie są wysyłane do GKD ani do żadnego backendu tego projektu.

> Nie traktuj lokalnego storage jako sejfu na sekrety o wysokiej wartości. Docelowo dodamy możliwość sesyjnego klucza oraz providerów lokalnych.

## Prywatność

Projekt nie ma własnego serwera do przechowywania historii rozmów. Capture trafia do lokalnego IndexedDB. Dane opuszczają komputer tylko wtedy, gdy świadomie włączysz konkretną funkcję AI i podasz własny klucz dostawcy.

Zobacz [Privacy & threat model](docs/privacy.md).

## Development

```bash
npm test
npm run build
npm run package
```

## CI / release

GitHub Actions testuje parsery, buduje unpacked extension, publikuje ZIP jako artifact, publikuje GitHub Pages i posiada jawny **mock** kroku Chrome Web Store. Publikacja do Chrome Web Store pozostaje mockiem do czasu dodania danych aplikacji/sekretów ze Store.

## Status

To wczesny build. DOM Messengera nie jest publicznym, stabilnym API i może się zmieniać. Jeśli Meta zmieni strukturę DOM lub sposób ładowania mediów, selektory/extractory będą wymagały aktualizacji.

## License

MIT
