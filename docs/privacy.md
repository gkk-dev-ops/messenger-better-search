# Privacy & threat model

Messenger Better Search is designed local-first.

## Primary data source

Conversation history is imported from files the user explicitly selects from Meta's **Export Your Information** feature.

The extension does not use Messenger UI automation to collect conversation history.

## Stored locally

The extension stores imported messages, timestamps, conversation metadata, attachment references, optional transcripts, optional image descriptions and optional embeddings in extension-owned browser storage (IndexedDB).

Settings and API keys use extension-local storage.

## Messenger search bridge

Messenger Better Search may inject a small **Open in Better Search** shortcut next to Messenger's native **Search in conversation** UI.

The bridge reads only the search query currently entered by the user so it can open the same query in the local Better Search archive.

It does **not**:

- read Messenger search result rows,
- import conversation messages from the page DOM,
- automatically scroll conversations,
- capture Messenger media,
- send Messenger conversation content to GKD.

## External processing

External providers are contacted only for features that the user explicitly enables.

Current optional providers include:

- ElevenLabs for speech-to-text,
- OpenAI-compatible functionality for image understanding, embeddings and group analysis.

When a feature uses an external provider, the relevant content is sent to that provider and their privacy/retention policies apply.

## No GKD data backend

The project currently has no GKD-hosted backend receiving conversation history, Meta export archives or API keys from the extension.

## Local security limitations

Browser extension storage should not be treated as encrypted-at-rest secure storage against a compromised browser profile, operating system or device.

Future versions may offer encrypted archives, ephemeral API keys and local-model providers.

## Meta compatibility

The official Meta export format and Messenger UI can change over time.

Changes to Meta export JSON may require parser updates. Changes to Messenger UI may temporarily affect only the optional search shortcut; they do not prevent previously imported archives from being searched locally.
