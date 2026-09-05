# Changelog

## [0.3.0](https://github.com/brunolabbe/tools/compare/downloader-v0.2.0...downloader-v0.3.0) (2026-09-05)


### Features

* **downloader:** EGRESS_CA_FILE now reaches the Chromium and yt-dlp resolver tiers (dl-37) ([#147](https://github.com/brunolabbe/tools/issues/147)) ([1aae8c8](https://github.com/brunolabbe/tools/commit/1aae8c8d8cdf3f27f5555e426557808641292e45))
* **downloader:** serve a Content-Security-Policy for the web UI (dl-35) ([#143](https://github.com/brunolabbe/tools/issues/143)) ([6b98b5d](https://github.com/brunolabbe/tools/commit/6b98b5d2cf60b2c4c74de559a306e2edbac3d639))
* **downloader:** show a preview image, and stop sending source credentials to the client (dl-29) ([#128](https://github.com/brunolabbe/tools/issues/128)) ([9856e6a](https://github.com/brunolabbe/tools/commit/9856e6a5a6aee30da16179ed7f543b45c09aca38))


### Fixes

* **downloader:** build the contract before the dev server starts ([#151](https://github.com/brunolabbe/tools/issues/151)) ([896806c](https://github.com/brunolabbe/tools/commit/896806c1610978362d8ab075c0b60c6ea01d53ec))
* **downloader:** encode fixture certificate serials as positive integers (dl-36) ([#134](https://github.com/brunolabbe/tools/issues/134)) ([e9f516b](https://github.com/brunolabbe/tools/commit/e9f516b36195c3344fe98e0d4b36ea7c6b83f7d2))
* **downloader:** give the whole egress the operator's CA, as EGRESS_CA_FILE (dl-31) ([#125](https://github.com/brunolabbe/tools/issues/125)) ([68f4272](https://github.com/brunolabbe/tools/commit/68f4272044e1ce17f3401a08ffd10fdb9aa62387))
* **downloader:** meter the download route and stop logging its token (dl-23) ([#123](https://github.com/brunolabbe/tools/issues/123)) ([6f29eb0](https://github.com/brunolabbe/tools/commit/6f29eb0b0a9b7e3e950d43975e477e79d4f7cfd3))
* **downloader:** name a refused certificate in both resolver tiers (dl-34) ([#142](https://github.com/brunolabbe/tools/issues/142)) ([a7a795e](https://github.com/brunolabbe/tools/commit/a7a795ecc10abdcc2be209a437017b015fe44e66))
* **downloader:** remove the unauthenticated endpoint that listed every job (dl-32) ([#152](https://github.com/brunolabbe/tools/issues/152)) ([5f6e92c](https://github.com/brunolabbe/tools/commit/5f6e92c593e99c11792aa71b76c66b79550ec4bb))
* **downloader:** stop the egress proxy minting unparseable certificate serials (dl-33) ([#141](https://github.com/brunolabbe/tools/issues/141)) ([c2ff413](https://github.com/brunolabbe/tools/commit/c2ff4134320b0a33781f7798cdc7da48fec48f02))
* **downloader:** stop the ttml row reading a hostname as a format claim (dl-28) ([#99](https://github.com/brunolabbe/tools/issues/99)) ([730aa90](https://github.com/brunolabbe/tools/commit/730aa907cd8310ad57171958143785da48cdf958))
* **downloader:** stop the vtt and srt rows reading a hostname as a format claim (dl-25) ([#94](https://github.com/brunolabbe/tools/issues/94)) ([a44016a](https://github.com/brunolabbe/tools/commit/a44016a67dc2eb751498ca334df5731da42c7f0d))
* **downloader:** verify HLS and DASH segment origins at the egress proxy (dl-27) ([#115](https://github.com/brunolabbe/tools/issues/115)) ([ec1dd6b](https://github.com/brunolabbe/tools/commit/ec1dd6b2118d7c1b1948c12146f08c57827e5758))
* **downloader:** weigh a rendition instead of trusting its declared bitrate (dl-30) ([#112](https://github.com/brunolabbe/tools/issues/112)) ([790c4a2](https://github.com/brunolabbe/tools/commit/790c4a24178d75e6a0cd44a40e2fbd15892415b7))

## [0.2.0](https://github.com/brunolabbe/tools/compare/downloader-v0.1.1...downloader-v0.2.0) (2026-08-23)


### Features

* **planner:** run the fan-out as a job (pl-16) ([09bd161](https://github.com/brunolabbe/tools/commit/09bd161435c596920039ead5a339729b1126e3ac))
* **planner:** run the fan-out as a job (pl-16) ([a112cd4](https://github.com/brunolabbe/tools/commit/a112cd46751880762d44bf70bec79082ba230b89))


### Fixes

* **core:** make the image scan fail by name, and stop it passing blind (pl-17) ([#56](https://github.com/brunolabbe/tools/issues/56)) ([2ea0631](https://github.com/brunolabbe/tools/commit/2ea06318a4dcea09c5bf181f85d2d6222cf6d357))
* **downloader:** answer an unknown endpoint with NOT_FOUND (dl-17) ([#65](https://github.com/brunolabbe/tools/issues/65)) ([1f1e428](https://github.com/brunolabbe/tools/commit/1f1e4283f427b7574c65cf3487437fc9a83478e6))
* **downloader:** bind the web dev server to the host it is given (dl-22) ([#78](https://github.com/brunolabbe/tools/issues/78)) ([30f77c9](https://github.com/brunolabbe/tools/commit/30f77c9e388639e555ac2b55f23b6ac8012d39cc))
* **downloader:** carry the re-probe mark to a client watching a live stream (dl-20) ([#86](https://github.com/brunolabbe/tools/issues/86)) ([b76dca4](https://github.com/brunolabbe/tools/commit/b76dca44f0bdb0daa9ac069a8ec86a99ea8ef7c1))
* **downloader:** check the site's certificate before downloading its video (dl-19) ([#76](https://github.com/brunolabbe/tools/issues/76)) ([da81902](https://github.com/brunolabbe/tools/commit/da81902c78db293814ae2f36e965985e8f9b3b6f))
* **downloader:** classify a subtitle by its codec, not its last two letters (dl-24) ([#83](https://github.com/brunolabbe/tools/issues/83)) ([848af10](https://github.com/brunolabbe/tools/commit/848af10871019a813363fad023bf12086ae347c5))
* **downloader:** hold the pipeline at its high-water mark through a re-probe (dl-18) ([#73](https://github.com/brunolabbe/tools/issues/73)) ([b15bcff](https://github.com/brunolabbe/tools/commit/b15bcff918fdf16435fdf27ee7c34d606ae8c6cb))
* **downloader:** pin the unverified HLS segment gap and warn operators about it (dl-21) ([#87](https://github.com/brunolabbe/tools/issues/87)) ([657fd36](https://github.com/brunolabbe/tools/commit/657fd36e3115c8d5adfd853fd6b2c0cdc7c98a9f))
* **downloader:** say whether the proxy refused a fetch or could not reach it (dl-26) ([#84](https://github.com/brunolabbe/tools/issues/84)) ([59974b9](https://github.com/brunolabbe/tools/commit/59974b9a1422c7b73752f0bd45763832998d119c))

## [0.1.1](https://github.com/brunolabbe/tools/compare/downloader-v0.1.0...downloader-v0.1.1) (2026-08-14)


### Fixes

* **downloader:** model a re-probe as a status move (dl-9) ([#5](https://github.com/brunolabbe/tools/issues/5)) ([24c4239](https://github.com/brunolabbe/tools/commit/24c42399213b970f4e3b207a18bba8cf438eabee))
* **downloader:** put the browser and yt-dlp tiers behind the egress proxy (dl-12) ([#10](https://github.com/brunolabbe/tools/issues/10)) ([7b3b0f4](https://github.com/brunolabbe/tools/commit/7b3b0f468e1383c10defbda1989544a6aa667a40))
