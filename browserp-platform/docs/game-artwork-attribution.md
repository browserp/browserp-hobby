# Game artwork

Verified 6 September 2026. The directory uses authentic publisher artwork to identify games. The image files are local copies, so browsing does not contact the publishers' image servers. No generated imitation artwork was used for this update. Artwork remains the property of its respective publisher; its presence is not an endorsement of BrowseRP or of any listed server.

The exact image URLs, publisher names, source pages and local filenames are recorded in [`public/assets/games/artwork-sources.json`](../public/assets/games/artwork-sources.json). The Steam images were resolved from each game's publisher-maintained store page through Steam's public `appdetails` endpoint. They are the small original header assets, without image alterations. Other files are the original publisher image or a publisher-supplied responsive size.

| BrowseRP category | Artwork source |
| --- | --- |
| FiveM | [GTA V Legacy — Rockstar Games on Steam](https://store.steampowered.com/app/271590/) |
| RedM | [Red Dead Redemption 2 — Rockstar Games on Steam](https://store.steampowered.com/app/1174180/) |
| Roblox | [Roblox official press kit, Renders & Artwork](https://about.roblox.com/press-kit) |
| Minecraft | [Minecraft's official key-art update](https://www.minecraft.net/en-us/article/key-art-update) |
| Forza | [Forza Horizon 5 — Xbox Game Studios on Steam](https://store.steampowered.com/app/1551360/) |
| Garry's Mod | [Garry's Mod — Facepunch on Steam](https://store.steampowered.com/app/4000/) |
| ARMA | [Arma 3 — Bohemia Interactive on Steam](https://store.steampowered.com/app/107410/) |
| VRChat | [VRChat on Steam](https://store.steampowered.com/app/438100/) |
| DayZ | [DayZ — Bohemia Interactive on Steam](https://store.steampowered.com/app/221100/) |
| Project Zomboid | [Project Zomboid — The Indie Stone on Steam](https://store.steampowered.com/app/108600/) |
| Euro Truck Simulator 2 | [Euro Truck Simulator 2 — SCS Software on Steam](https://store.steampowered.com/app/227300/) |
| Assetto Corsa | [Assetto Corsa — Kunos / 505 Games on Steam](https://store.steampowered.com/app/244210/) |
| BeamNG.drive | [BeamNG.drive on Steam](https://store.steampowered.com/app/284160/) |
| GTA 6 Roleplay / 6M | [Rockstar's official GTA VI media page, Vice City Postcard](https://www.rockstargames.com/VI/media) |

The GTA VI image is the underlying game's official art, not a 6M logo. The Coming Soon section describes planned BrowseRP categories. It does not announce roleplay support, an official 6M product, a PC launch, or playable GTA VI servers. Rockstar's official site currently lists GTA VI for PlayStation 5 and Xbox Series X/S; the BrowseRP page links there for current news instead of hard-coding a game release date.

Existing favicon inspection found real alpha transparency in `favicon.ico`, `browserp-icon-48.png`, `browserp-icon-192.png` and `browserp-icon-512.png`. Retain the supplied RP mark; use a stable crawlable PNG icon URL in page metadata. Search-engine caches and their tile treatment can delay or affect the displayed favicon independently of the asset's transparency.
