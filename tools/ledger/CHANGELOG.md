# Changelog

## [0.4.1](https://github.com/brunolabbe/tools/compare/ledger-v0.4.0...ledger-v0.4.1) (2026-10-24)


### Fixes

* **ledger:** keep a number or date in a workbook's free-text cells instead of dropping it (lg-68) ([#626](https://github.com/brunolabbe/tools/issues/626)) ([940e451](https://github.com/brunolabbe/tools/commit/940e4511a3b3e084df56254cc8b3d0024b7684ca))
* **ledger:** read a paste against alternating workbook dates in about a second, not a minute (lg-65) ([#606](https://github.com/brunolabbe/tools/issues/606)) ([a99bde4](https://github.com/brunolabbe/tools/commit/a99bde49be56d441de166a76a6602902418c6982))
* **ledger:** size mortgage radios as radios and give an item's name a row (lg-64) ([#604](https://github.com/brunolabbe/tools/issues/604)) ([6785a64](https://github.com/brunolabbe/tools/commit/6785a64c9923c78075253b268caf548896edef38))

## [0.4.0](https://github.com/brunolabbe/tools/compare/ledger-v0.3.0...ledger-v0.4.0) (2026-10-22)


### Features

* **ledger:** a mortgage that ended or never was reads as such on Stats and Home (lg-55) ([#581](https://github.com/brunolabbe/tools/issues/581)) ([5c6077f](https://github.com/brunolabbe/tools/commit/5c6077f3ace6115d4b583d0bbb607fa038956fea))
* **ledger:** an admin retires a person from the books at the next close (lg-35) ([#583](https://github.com/brunolabbe/tools/issues/583)) ([e155da2](https://github.com/brunolabbe/tools/commit/e155da25e9eef070d3eb12e06f490493eabb51c0))
* **ledger:** choose how the mortgage splits — by shares, equally or at the ratio (lg-63) ([#594](https://github.com/brunolabbe/tools/issues/594)) ([19b01f7](https://github.com/brunolabbe/tools/commit/19b01f74c505086d123390e424a8a4154bdcf69d))
* **ledger:** list every bank row, searched, filtered and sorted (lg-41) ([#563](https://github.com/brunolabbe/tools/issues/563)) ([370f744](https://github.com/brunolabbe/tools/commit/370f74486f9950cee0c784a9b8c4a0b924c9b54c))
* **ledger:** report the dates a paste names otherwise than the workbook (lg-58) ([#596](https://github.com/brunolabbe/tools/issues/596)) ([aaccab2](https://github.com/brunolabbe/tools/commit/aaccab20e1a46c3e17681c8a1ee7878d03ca9de3))


### Fixes

* **ledger:** a stored paste says how many of its rows wait in the inbox (lg-54) ([#574](https://github.com/brunolabbe/tools/issues/574)) ([0097777](https://github.com/brunolabbe/tools/commit/00977771155eab9b60c2227e78028139e87be384))
* **ledger:** refuse a paste whose reading has a rival three days off (lg-61) ([#586](https://github.com/brunolabbe/tools/issues/586)) ([2d1b22b](https://github.com/brunolabbe/tools/commit/2d1b22bb474e3822e4fda0dacb3eeb3c416e26fa))
* **ledger:** refuse C1 controls and zero-width characters in a member's address (lg-57) ([#573](https://github.com/brunolabbe/tools/issues/573)) ([59629ae](https://github.com/brunolabbe/tools/commit/59629aec46ba13c76989293dc16e53745b7f920c))
* **ledger:** refuse control characters in a member's address (lg-52) ([#560](https://github.com/brunolabbe/tools/issues/560)) ([d84c885](https://github.com/brunolabbe/tools/commit/d84c885247071fb07d9e98924534a00931ff0aff))
* **ledger:** stop a paste double-storing a day the workbook re-dated and reordered (lg-59) ([#564](https://github.com/brunolabbe/tools/issues/564)) ([a3fe637](https://github.com/brunolabbe/tools/commit/a3fe637bcd827440d7e3514edb747c9d2109081d))

## [0.3.0](https://github.com/brunolabbe/tools/compare/ledger-v0.2.0...ledger-v0.3.0) (2026-10-18)


### Features

* **ledger:** a blank salary leaves a person out of the year's ratio (lg-29) ([#515](https://github.com/brunolabbe/tools/issues/515)) ([801c740](https://github.com/brunolabbe/tools/commit/801c7404767586c137c7b66f210c23b345facb08))
* **ledger:** an admin renames a person, and the books keep the id (lg-33) ([#541](https://github.com/brunolabbe/tools/issues/541)) ([e40a506](https://github.com/brunolabbe/tools/commit/e40a506aafaacd9bc94a9baec22fdd35a2ae4da9))
* **ledger:** change a member's address in one step (lg-34) ([#546](https://github.com/brunolabbe/tools/issues/546)) ([dbf4cd5](https://github.com/brunolabbe/tools/commit/dbf4cd5f320682c7aca5a6ded223585356ab91ab))
* **ledger:** manage households and their members from the app (lg-22) ([#472](https://github.com/brunolabbe/tools/issues/472)) ([3292943](https://github.com/brunolabbe/tools/commit/3292943712e433cd21fa0f489333f62a2518c919))
* **ledger:** name whose a receipt item's charge is, among more than two people (lg-30) ([#529](https://github.com/brunolabbe/tools/issues/529)) ([a6aaac7](https://github.com/brunolabbe/tools/commit/a6aaac798fc3ad5b6b00190095ef07686d3a268c))
* **ledger:** one file of books per household, chosen by who is asking (lg-21) ([#452](https://github.com/brunolabbe/tools/issues/452)) ([3a9b298](https://github.com/brunolabbe/tools/commit/3a9b298dc4587fda2cd56939d16aa75169541a76))
* **ledger:** photograph a receipt, read it with a model, confirm and file it (lg-8) ([#474](https://github.com/brunolabbe/tools/issues/474)) ([f52cef6](https://github.com/brunolabbe/tools/commit/f52cef62fd0bdadaa5d7bfbf68de0160034703d8))
* **ledger:** read a receipt's items, take off what is not shared or is the other's (lg-10) ([#498](https://github.com/brunolabbe/tools/issues/498)) ([5f318ac](https://github.com/brunolabbe/tools/commit/5f318acbf634fc6be78deabc9d0914418c72e65c))
* **ledger:** read the workbook through a described layout (lg-38) ([#542](https://github.com/brunolabbe/tools/issues/542)) ([a2203de](https://github.com/brunolabbe/tools/commit/a2203de17b0317adcaee77c31ec4d1d5263ed173))
* **ledger:** seed the service spending categories and backfill them from text (lg-53) ([#543](https://github.com/brunolabbe/tools/issues/543)) ([140bd78](https://github.com/brunolabbe/tools/commit/140bd78a4cb862e3344a541ea16100d9568ce6d3))
* **ledger:** settle a household of more than two people (lg-23) ([#508](https://github.com/brunolabbe/tools/issues/508)) ([2ec0be0](https://github.com/brunolabbe/tools/commit/2ec0be09440e5021c9edc508146aa7338355b06a))
* **ledger:** split a joint-account row's spending by its receipt items (lg-27) ([#506](https://github.com/brunolabbe/tools/issues/506)) ([72eb962](https://github.com/brunolabbe/tools/commit/72eb9624b0a841d5ae8b4d00f29995a9f5b033d3))


### Fixes

* **ledger:** a cent of rounding no longer refuses a receipt with nothing shared (lg-32) ([#519](https://github.com/brunolabbe/tools/issues/519)) ([495a5b7](https://github.com/brunolabbe/tools/commit/495a5b7a1f31cc7ba384c7956b671f05aeb02f11))
* **ledger:** flag taxable marks that do not give the printed taxes (lg-26) ([#504](https://github.com/brunolabbe/tools/issues/504)) ([1ba5098](https://github.com/brunolabbe/tools/commit/1ba5098e07343916a14af6cc348e39b26e4d6794))
* **ledger:** hold the receipt form until the household loads (lg-39) ([#535](https://github.com/brunolabbe/tools/issues/535)) ([b8fafcc](https://github.com/brunolabbe/tools/commit/b8fafccbedc7cf376a46d34b52887c02481bdc46))
* **ledger:** let a paste overlap the rows the workbook imported (lg-40) ([#548](https://github.com/brunolabbe/tools/issues/548)) ([f07e9c2](https://github.com/brunolabbe/tools/commit/f07e9c25931259ac88c34aa120709965eec1b85b))
* **ledger:** list and correct a closed period's card lines from the stats screen (lg-19) ([#449](https://github.com/brunolabbe/tools/issues/449)) ([d78ac28](https://github.com/brunolabbe/tools/commit/d78ac2875a77b1ea3bb5083ad9ee0299b5b04865))
* **ledger:** make the spending drill-down follow a receipt's split (lg-28) ([#517](https://github.com/brunolabbe/tools/issues/517)) ([d882a66](https://github.com/brunolabbe/tools/commit/d882a6682c12b2f980feaf61c3de5da21004f498))
* **ledger:** read the real workbook's summaries and salaries where they are (lg-37) ([#528](https://github.com/brunolabbe/tools/issues/528)) ([aba691b](https://github.com/brunolabbe/tools/commit/aba691b2ef171720539c3adf9f66c22a8d49ea93))
* **ledger:** refuse a non-string to a directory method as BAD_REQUEST (lg-25) ([#495](https://github.com/brunolabbe/tools/issues/495)) ([b08b694](https://github.com/brunolabbe/tools/commit/b08b694f03ef183793775d68724afffda67a44bf))
* **ledger:** refuse a NULL household id in the directory schema (lg-24) ([#485](https://github.com/brunolabbe/tools/issues/485)) ([191153e](https://github.com/brunolabbe/tools/commit/191153e5b4671ca86d1f07bb2c0686546427cb87))
* **ledger:** space the cards and make the stats charts easier to read ([#539](https://github.com/brunolabbe/tools/issues/539)) ([960f4b2](https://github.com/brunolabbe/tools/commit/960f4b2606dc2b5de62ec318f09255b24b164879))

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
