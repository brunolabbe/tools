# Changelog

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
