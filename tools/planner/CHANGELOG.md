# Changelog

## [0.5.0](https://github.com/brunolabbe/tools/compare/planner-v0.4.0...planner-v0.5.0) (2026-09-06)


### Features

* **planner:** find what is worth stopping for along a leg (pl-29) ([#102](https://github.com/brunolabbe/tools/issues/102)) ([98b5e61](https://github.com/brunolabbe/tools/commit/98b5e61ee698e3a80508a393bec9f358d49b20cf))


### Fixes

* **planner:** attribute geocoded places, and take provenance off the model (pl-36) ([#121](https://github.com/brunolabbe/tools/issues/121)) ([25ee1c7](https://github.com/brunolabbe/tools/commit/25ee1c7ec05b4d7c08c5d60599908c98e6ba7e18))
* **planner:** capture a real Overpass payload, and wire up notability (pl-33) ([#119](https://github.com/brunolabbe/tools/issues/119)) ([80bfc64](https://github.com/brunolabbe/tools/commit/80bfc64b08343096fc13b87f4fc6de6c889331eb))
* **planner:** choose among the geocoder's results instead of trusting the first (pl-34) ([#117](https://github.com/brunolabbe/tools/issues/117)) ([7a12b8b](https://github.com/brunolabbe/tools/commit/7a12b8bb49778e78d4db5da21049ce6c247a4117))
* **planner:** ground a place against the trip it belongs to (pl-37) ([#127](https://github.com/brunolabbe/tools/issues/127)) ([f5d5a0e](https://github.com/brunolabbe/tools/commit/f5d5a0ef236f1f43fc7874516a07227bdf34f5e9))
* **planner:** hold locate to a real Nominatim payload, closing pl-28 and pl-30 ([#104](https://github.com/brunolabbe/tools/issues/104)) ([1357007](https://github.com/brunolabbe/tools/commit/135700775675062c9ad4a93d5ee4fce4c5c80587))

## [0.4.0](https://github.com/brunolabbe/tools/compare/planner-v0.3.0...planner-v0.4.0) (2026-08-23)


### Features

* **planner:** ask where they are going third, and let it be blank (pl-18) ([#43](https://github.com/brunolabbe/tools/issues/43)) ([93686e5](https://github.com/brunolabbe/tools/commit/93686e52a8f30189e95c8cfa5b032fd6b0d44134))
* **planner:** cache grounding in a table with a TTL that varies by kind (pl-25) ([#66](https://github.com/brunolabbe/tools/issues/66)) ([6ad9de2](https://github.com/brunolabbe/tools/commit/6ad9de2da659ee5c57ee658b5abe13b7070bc463))
* **planner:** measure legs against a real routing engine, self-hosted (pl-28) ([#74](https://github.com/brunolabbe/tools/issues/74)) ([60e48e7](https://github.com/brunolabbe/tools/commit/60e48e7b02f6a5efc3249c2c63db7c1f4950ff68))
* **planner:** measure the legs, pack the days under them, name what went unmeasured (pl-27) ([#68](https://github.com/brunolabbe/tools/issues/68)) ([8cb1fa6](https://github.com/brunolabbe/tools/commit/8cb1fa676786eb837f8e17c6186758c508b41788))
* **planner:** one seam for everything that reaches outside, with a fixture default (pl-24) ([#61](https://github.com/brunolabbe/tools/issues/61)) ([fa1431f](https://github.com/brunolabbe/tools/commit/fa1431f4c9ad36708627197ccbe1153d09453abb))
* **planner:** read a plan, its provenance and what nothing checked (pl-10) ([#44](https://github.com/brunolabbe/tools/issues/44)) ([6291ee5](https://github.com/brunolabbe/tools/commit/6291ee58c530659886c9e5e861d41ab4cbf7dbb3))


### Fixes

* **core:** make the image scan fail by name, and stop it passing blind (pl-17) ([#56](https://github.com/brunolabbe/tools/issues/56)) ([2ea0631](https://github.com/brunolabbe/tools/commit/2ea06318a4dcea09c5bf181f85d2d6222cf6d357))
* **planner:** name the four bare intake fields for a screen reader (pl-21) ([#59](https://github.com/brunolabbe/tools/issues/59)) ([e1c40d1](https://github.com/brunolabbe/tools/commit/e1c40d11bc42b2ea82c92c1a8bfd37f114f2e95b))
* **planner:** scope a pin to the revision the reader is looking at (pl-22) ([#58](https://github.com/brunolabbe/tools/issues/58)) ([60793ed](https://github.com/brunolabbe/tools/commit/60793ed9b52f8857142427af0a21a8229588a6c1))

## [0.3.0](https://github.com/brunolabbe/tools/compare/planner-v0.2.0...planner-v0.3.0) (2026-08-16)


### Features

* **planner:** choose a roster and fan out over it (pl-5) ([7dc236b](https://github.com/brunolabbe/tools/commit/7dc236b9a00085515a64c6e08aeef3b1846ef073))
* **planner:** choose a roster and fan out over it (pl-5) ([cabdbb9](https://github.com/brunolabbe/tools/commit/cabdbb98b48e64fa769d081d921a16344cb6a649))
* **planner:** let a candidate run between two places (pl-15) ([80fff44](https://github.com/brunolabbe/tools/commit/80fff448f66fa307d1845a6652897102b55fb230))
* **planner:** let a candidate run between two places (pl-15) ([1ac6de6](https://github.com/brunolabbe/tools/commit/1ac6de6b7f56d839d8e7acbe904ccf13ed4c145e))
* **planner:** run the fan-out as a job (pl-16) ([09bd161](https://github.com/brunolabbe/tools/commit/09bd161435c596920039ead5a339729b1126e3ac))
* **planner:** run the fan-out as a job (pl-16) ([a112cd4](https://github.com/brunolabbe/tools/commit/a112cd46751880762d44bf70bec79082ba230b89))


### Fixes

* **planner:** carry the composer into the image (pl-16) ([b69a93a](https://github.com/brunolabbe/tools/commit/b69a93a899bfdf599f49aacd3efb26f49556bdf7))
* **planner:** stop the fence pattern backtracking on a hostile reply (pl-5) ([d986e02](https://github.com/brunolabbe/tools/commit/d986e0284923443e0fc6702f7488e6d8767ddd59))

## [0.2.0](https://github.com/brunolabbe/tools/compare/planner-v0.1.0...planner-v0.2.0) (2026-08-16)


### Features

* **planner:** add the plan document to the contract (pl-4) ([0afe1d4](https://github.com/brunolabbe/tools/commit/0afe1d4a4fba5819b8fcd6b727f22959a1e1c758))
* **planner:** add the plan document to the contract (pl-4) ([b90f651](https://github.com/brunolabbe/tools/commit/b90f651bdeb7d125793c2a4315944c08bc489d70))
* **planner:** add the question tree and the intake engine (pl-6) ([8491c3b](https://github.com/brunolabbe/tools/commit/8491c3bf20790d5a7771588e9fbc08f50347c976))
* **planner:** add the trip brief to the contract (pl-3) ([4c56e6a](https://github.com/brunolabbe/tools/commit/4c56e6a755c219aab2ad8701517a099dfcea5cde))
* **planner:** add the trip brief to the contract (pl-3) ([2da6582](https://github.com/brunolabbe/tools/commit/2da65827a6b2729464100f15aba7649202311bf0))
* **planner:** pack the days in code, and name what was not checked (pl-9) ([811f69f](https://github.com/brunolabbe/tools/commit/811f69fa85a30020cbb857b10666c05d872e229b))
* **planner:** pack the days in code, and name what was not checked (pl-9) ([fcedbfa](https://github.com/brunolabbe/tools/commit/fcedbfac4d6ccd47fe56f6752ec3efd6f7e6145b))
* **planner:** persist the intake and put a wizard over it (pl-7) ([e8527ff](https://github.com/brunolabbe/tools/commit/e8527ffb3e5ad76df34dbb3f8a22a46b8f2fdbfe))
* **planner:** persist the intake and put a wizard over it (pl-7) ([f32dd74](https://github.com/brunolabbe/tools/commit/f32dd74b541a688e20da9129260731dfba20aa56))
* **planner:** review the question tree as content (pl-14) ([50701dc](https://github.com/brunolabbe/tools/commit/50701dc371f916d314eb9b466fbee6a8c69773ca))
* **planner:** scaffold a second tool for planning trips ([#1](https://github.com/brunolabbe/tools/issues/1)) ([99e60bc](https://github.com/brunolabbe/tools/commit/99e60bcca13ea574d97b0e4dd86dff61ef2ac9ce))
* **planner:** the question tree and the intake engine (pl-6) ([b917c88](https://github.com/brunolabbe/tools/commit/b917c88072c3dd71fe5b0c4ce033151f2f3ae3bc))


### Fixes

* **planner:** append the intake as migration 3, not 2 (pl-7) ([c1012f6](https://github.com/brunolabbe/tools/commit/c1012f64aa6173f15fcbf86f38aca6edaa492345))
