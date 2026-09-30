# Font provenance

- `TwemojiCountryFlags.woff2` — the country-flag glyphs (regional-indicator
  pairs, plus the England/Scotland/Wales tag sequences) of **Twemoji**, graphics
  © Twitter, Inc and other contributors, licensed CC-BY 4.0
  (https://creativecommons.org/licenses/by/4.0/). Packaged as a flag-only font by
  the MIT-licensed `country-flag-emoji-polyfill` 0.1.10 by TalkJS
  (https://github.com/talkjs/country-flag-emoji-polyfill); both licences are in
  `TwemojiCountryFlags-LICENSE.md`. Unmodified.

It is bundled so a flag renders on every platform, offline: Windows and minimal
Linux have no colour flag glyphs and show the two letters or an empty box. The
`@font-face` in `src/styles.css` limits it to the regional indicators with
`unicode-range`, so a browser downloads it only once a flag is on screen.
