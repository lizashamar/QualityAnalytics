# Conversation Quality Analytics

A professional workspace for reviewing the quality of RU, KZ and EN support chats and call transcripts. The interface is primarily Russian. Users import a dataset group, evaluate conversations against a versioned checklist, investigate scores through transcript evidence, and resolve human appeals.

The implementation uses modular vanilla JavaScript and scoped CSS with a FastAPI/SQLite backend. It supports a local demonstration and a connected API; no login is required by this prototype.

The primary journey is overview → filtered conversations → evaluation and evidence → appeal and reviewer decision. Checklist authors configure criteria, answer scales, weights, N/A conditions and independent gross-violation flags. Saving creates a new version; existing evaluations retain their original methodology.

Analytics describe the loaded group and the latest evaluation of each conversation, including reviewer decisions. The trend groups those latest evaluations by UTC date; it is not a complete historical series. The current records do not provide agent or team metadata. Cross-group appeal evidence is cached separately from the loaded dataset.

Product priorities: fast investigation, understandable scoring, honest data presentation, keyboard access, responsive professional use, and preserved API/scoring contracts. The established Freedom-inspired green identity is retained without implying official affiliation. Visual guidance lives in [DESIGN.md](DESIGN.md); implementation and validation notes live in `docs/design/`.
