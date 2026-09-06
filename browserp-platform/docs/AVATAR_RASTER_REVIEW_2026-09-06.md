# Profile picture validation — 6 September 2026

Reproduced an inherited upload gap: a94-byte object with a PNG-shaped header, invalid checksums and non-decompressible IDAT was accepted by the mocked real avatar route, stored and labelled validated. A PNG signature and declared size were insufficient evidence that the picture would decode.

The avatar route now also uses the existing advert raster validation, extracted into a shared internal helper. It checks chunk checksums/order, RGB/RGBA8 representation, non-interlaced512×512 pixels, bounded complete decompression, exact scanline length, legal row filters and absence of trailing compressed data. Canonical base64 and the existing1MiB/allowed-chunk rules remain required. Rejection happens before any storage or profile write. Accepted avatar bytes remain unchanged; adverts continue retaining only their existing core image chunks. No extra hosted function, external image service or production dependency was added.

Twenty-five focused upload/authentication/advert/static-image tests passed. Fifteen malformed avatar variants cover corruption with valid and invalid checksums, short/long/truncated rasters, excessive expansion, invalid scanline filters, unsupported headers, duplicate headers, nonconsecutive chunks and trailing streams. Valid RGB/RGBA/all-five-filter/split-IDAT fixtures pass. Actual Chromium, Firefox and WebKit512×512 canvas PNG encodings also pass this helper and their own image decoder; all contexts were closed. These are generated fixtures, not real member uploads or physical-device evidence.

Independent review found no blocking regression; detailed dimension feedback for advert errors is retained. This is file-format validation, not a claim that uploaded pictures are semantically appropriate or free of every possible decoder vulnerability.

References: [PNG specification](https://www.w3.org/TR/png-3/), [Node bounded decompression](https://nodejs.org/api/zlib.html). Native evidence: `avatar-native-encoding-2026-09-06.json`.
