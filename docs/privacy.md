# Privacy & threat model

Messenger Better Search is designed local-first.

## Stored locally

The extension stores captured messages, timestamps, extracted media metadata, transcripts, image descriptions and embeddings in extension-owned browser storage (IndexedDB). Settings and API keys use extension-local storage.

## External processing

External providers are contacted only for features that the user explicitly enables:

- ElevenLabs: speech-to-text,
- OpenAI: image understanding, embeddings and group analysis.

The relevant message/audio/image content is sent to that provider when the feature runs. Provider privacy/retention policies apply.

## No GKD data backend

The project currently has no GKD-hosted backend receiving conversation history, API keys or analytics from the extension.

## Messenger / Meta

The extension operates on the Messenger UI visible to the signed-in user. It is not an official Meta integration. Messenger's DOM and media delivery mechanisms may change.

## Limitations

Browser extension storage should not be treated as encrypted-at-rest secure storage against a compromised browser profile or machine. Future versions may offer ephemeral keys and local model providers.
