# Changelog

## [0.2.0](https://github.com/brunolabbe/tools/compare/ledger-v0.1.0...ledger-v0.2.0) (2026-10-12)


### Features

* **ledger:** file a row from three matching answers, and list it for review (lg-17) ([#408](https://github.com/brunolabbe/tools/issues/408)) ([7709411](https://github.com/brunolabbe/tools/commit/7709411e9b16ddf4457e571ace16d2b57cb6ba79))
* **ledger:** history and stats, drawn as charts on a phone (lg-9) ([#416](https://github.com/brunolabbe/tools/issues/416)) ([817e7ce](https://github.com/brunolabbe/tools/commit/817e7cee24bb5a9bc3312bbc1bffa35ae2ab249f))
* **ledger:** import the workbook's history, verified before it is written (lg-7) ([#396](https://github.com/brunolabbe/tools/issues/396)) ([55a0e9e](https://github.com/brunolabbe/tools/commit/55a0e9e4c9930762d3aaee5c01a62568ea2f7089))
* **ledger:** open the bank rows behind a spending period and set their category (lg-18) ([#426](https://github.com/brunolabbe/tools/issues/426)) ([9d0e2ea](https://github.com/brunolabbe/tools/commit/9d0e2ea62f9f62d54058ad99550345be8400fac9))
* **ledger:** spending categories on bank rows and period lines (lg-15) ([#406](https://github.com/brunolabbe/tools/issues/406)) ([d55a1f4](https://github.com/brunolabbe/tools/commit/d55a1f4269e45abf176bc6629eacd14dbc042616))
* **ledger:** who belongs to which household, read from a directory database (lg-20) ([#441](https://github.com/brunolabbe/tools/issues/441)) ([b8a7819](https://github.com/brunolabbe/tools/commit/b8a78192355d617afdd13a00c3e9e24961e20356))


### Fixes

* **ledger:** keep the open spending rows through a failed read and past midnight (lg-18) ([#431](https://github.com/brunolabbe/tools/issues/431)) ([a0c52e2](https://github.com/brunolabbe/tools/commit/a0c52e23c58db6f4a09f6172497abaf1d1d20f43))

## 0.1.0 (2026-10-07)


### Features

* **ledger:** classify rows by rule and put the rest in an inbox (lg-4) ([#345](https://github.com/brunolabbe/tools/issues/345)) ([d6b72d5](https://github.com/brunolabbe/tools/commit/d6b72d5a495523cf3bca6d9fb9477444cb9ff454))
* **ledger:** most specific rule takes a row, inbox suggests from history (lg-16) ([#384](https://github.com/brunolabbe/tools/issues/384)) ([843c03b](https://github.com/brunolabbe/tools/commit/843c03bbe50faaaa6b747c1c98aefb249fb9e7a0))
* **ledger:** parse an AccèsD paste and prove it with its own running balance (lg-1) ([#330](https://github.com/brunolabbe/tools/issues/330)) ([b4ac37e](https://github.com/brunolabbe/tools/commit/b4ac37e67d3b9e4ef2e3af38614e4f33c2d697d7))
* **ledger:** people, salaries and ratios, and what each bucket holds (lg-5) ([#354](https://github.com/brunolabbe/tools/issues/354)) ([b96e958](https://github.com/brunolabbe/tools/commit/b96e9589cdbb6721fa6714f9f2e5c91a1e118206))
* **ledger:** periods of personal-card spending, closed with the matching rule (lg-6) ([#368](https://github.com/brunolabbe/tools/issues/368)) ([0f1a32e](https://github.com/brunolabbe/tools/commit/0f1a32e6ba887bb1d5751af55df0df23f13ce528))
* **ledger:** store a pasted statement, chained onto what is stored (lg-2) ([#342](https://github.com/brunolabbe/tools/issues/342)) ([ebb808b](https://github.com/brunolabbe/tools/commit/ebb808b8a0f30543a056f93a3c8e30b2137e8e7f))
* **ledger:** verify the Cloudflare Access token on every API request (lg-3) ([#333](https://github.com/brunolabbe/tools/issues/333)) ([24acb04](https://github.com/brunolabbe/tools/commit/24acb043ac3f2db1c55e1eac01db371b7f234f73))


### Fixes

* **ledger:** build the contract before the dev API starts (lg-12) ([#363](https://github.com/brunolabbe/tools/issues/363)) ([3bf1791](https://github.com/brunolabbe/tools/commit/3bf17917b0569c81d99326fbca89e7d15601eb3d))
* **ledger:** read a whole-page paste, its empty month and its footer (lg-14) ([#377](https://github.com/brunolabbe/tools/issues/377)) ([f36bf38](https://github.com/brunolabbe/tools/commit/f36bf380c4eb00179748fa7000abee16645bc2ee))
* **ledger:** weigh a matched settlement deposit at its period's ratio (lg-13) ([#386](https://github.com/brunolabbe/tools/issues/386)) ([4c04a67](https://github.com/brunolabbe/tools/commit/4c04a67c18124db25b2daf72f679fc4fe1ed4631))
