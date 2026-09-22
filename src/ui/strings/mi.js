/**
 * Te reo Māori.
 *
 * Drafted for review: these translations were written by the development
 * team, not by a fluent speaker or a licensed translator. Please have them
 * checked (Te Taura Whiri i te Reo Māori conventions, macrons, register)
 * before public use. Keys missing here fall back to English.
 */
export default {
  code: 'mi',
  name: 'Te reo Māori',
  strings: {
    'app.title': 'Ārahi ara ā-roto',

    // HUD
    'hud.noDestination': 'Kōwhiria he wāhi haere',
    'hud.destination': 'Ki {name}',
    'hud.distance': '{metres} m',
    'hud.distanceLong': '{metres} mita e toe ana',
    'hud.nextTurn': 'Ka whai ake: {name}',
    'hud.arrived': 'Kua tae koe ki {name}',
    'hud.arrivedShort': 'Kua tae',
    'hud.rescan.title': 'Kāore i te mārama tō wāhi',
    'hud.rescan.body': 'Tohua te kāmera ki tētahi tohu, kūaha, waehere QR rānei kia kitea anō koe.',
    'hud.rescan.action': 'Āe',
    'hud.error.retry': 'Ngana anō',
    'hud.error.dismiss': 'Kati',
    'hud.floorChange.up': 'Piki ki {floor} mā te {via}',
    'hud.floorChange.down': 'Heke ki {floor} mā te {via}',
    'hud.changeDestination': 'Huri i te wāhi haere',
    'hud.cancel': 'Whakamutu te ārahi',

    // Errors
    'error.venueLoad': 'Kāore i taea te uta i te mahere o te wāhi.',
    'error.cameraDenied': 'Kāore i whakaaetia te kāmera. Ka taea tonu te mahere papa.',
    'error.noCamera': 'Kāore he kāmera i kitea. Whakamahia te mahere papa.',
    'error.unsupported':
      'Kāore e taea e tēnei pūtirotiro te whakamahi i te kāmera. Whakamahia te mahere papa.',
    'error.positioningExhausted':
      'Kāore e taea te kite i tō wāhi. Matawaia he tohu QR, whakamahia rānei te mahere papa.',
    'error.noRoute': 'Kāore he ara ki {name} i raro i ō tautuhinga.',
    'error.noRouteHint': 'Whakangāwaritia ngā tātari uru, tirohia rānei ngā hāora tuwhera.',
    'error.generic': 'I hapa tētahi mea: {message}',

    // Destination picker
    'picker.title': 'Kei hea koe e haere ana?',
    'picker.searchLabel': 'Rapua he wāhi haere',
    'picker.searchPlaceholder': 'Rapua mā te ingoa, hei tauira “Clinic B”, “wharepaku” rānei',
    'picker.clearSearch': 'Ūkui i te rapu',
    'picker.categories': 'Tirotiro mā te kāwai',
    'picker.allCategories': 'Katoa',
    'picker.results': '{count} wāhi haere',
    'picker.resultsOne': '1 wāhi haere',
    'picker.noResults': 'Kāore he mea e hāngai ana ki “{query}”.',
    'picker.floor': '{floor}',
    'picker.alias': 'Ka mōhiotia anō ko {aliases}',
    'picker.select': 'Ārahi ki {name}',
    'picker.highContrast': 'Tauaro nui',
    'picker.close': 'Kati',
    'picker.language': 'Reo',

    // Floor plan view
    'floorplan.title': 'Mahere papa',
    'floorplan.floor': '{name}',
    'floorplan.you': 'Kei konei koe',
    'floorplan.destination': 'Wāhi haere',
    'floorplan.route': 'Ara',
    'floorplan.noPose': 'E kimi ana i tō wāhi…',
    'floorplan.otherFloor': 'Kei {name} tō wāhi haere.',
    'floorplan.summary':
      'Mahere papa o {floor}. Kei {x}, {y} mita koe, e anga ana ki {heading} tākiri.',
    'floorplan.rotation': 'Anga o te mahere',
    'floorplan.headingUp': 'Anga ki runga',
    'floorplan.northUp': 'Raki ki runga',

    // View switcher
    'view.ar': 'Tirohanga kāmera',
    'view.floorplan': 'Mahere papa',
    'view.switchHint': 'Hikina te waea mō te tirohanga kāmera, tukua ki raro mō te mahere papa.',

    // Arrow
    'arrow.distance': '{metres} m',

    // Categories
    'category.clinic': 'Ngā whare haumanu',
    'category.facility': 'Ngā whakaurunga',
    'category.service': 'Ngā ratonga',
    'category.retail': 'Ngā toa',
    'category.food': 'Kai me te inu',
    'category.exit': 'Ngā putanga',
    'category.staff': 'Kaimahi',
    'category.ward': 'Ngā wāri',

    'category.other': 'Ētahi atu',

    // Spoken guidance
    'speech.toggle': 'Ārahi ā-reo',
    'speech.on': 'Kua whakakāhia te ārahi ā-reo',
    'speech.off': 'Kua whakawetohia te ārahi ā-reo',
    'speech.rate': 'Tere o te kōrero',
    'speech.rate.slow': 'Pōturi',
    'speech.rate.normal': 'Waenga',
    'speech.rate.fast': 'Tere',
    'speech.unsupported': 'Kāore te ārahi ā-reo e wātea ana i tēnei pūtirotiro.',
    'speech.destinationSet': 'E ārahi ana ki {name}. {metres} mita e toe ana.',
    'speech.nextStep': 'Haere tonu {metres} mita ki {name}.',
    'speech.floorChange.up': 'Piki ki {floor} mā te {via}.',
    'speech.floorChange.down': 'Heke ki {floor} mā te {via}.',
    'speech.arrived': 'Kua tae koe ki {name}.',
    'speech.rescan': 'Kāore i te mārama tō wāhi. Tohua te kāmera ki tētahi tohu, waehere QR rānei.',
    'speech.cancelled': 'Kua whakamutua te ārahi.',

    // Handled states
    'notice.offline':
      'Kei waho koe i te ipurangi. Ka mahi tonu te mahere papa me ngā ara; tērā pea kāore te tautuhi wāhi.',
    'notice.lowBattery': 'Kua iti te pākahiko. Kua huri ki te mahere papa hei penapena hiko.',
    'notice.venueCached':
      'E whakaatu ana i tētahi kape kua tiakina o te mahere; tērā pea kua tawhito.',
    'notice.cameraDenied':
      'Kāore i whakaaetia te kāmera — e whakamahi ana i te mahere papa. Tērā pea he iti te tautuhi wāhi.',
    'notice.noPosition': 'Kāore tō wāhi e wātea ana. Ka tīmata ngā ara i te tomokanga matua.',
    'error.venueLoadNoCache':
      'Kāore i taea te uta i te mahere, kāore hoki he kape kua tiakina. Hono ki te ipurangi, ka ngana anō.',

    // Runtime config
    'closure.notice': 'Kua kati: {list}',
    'closure.item': '{name} ({reason})',
    'closure.itemNoReason': '{name}',
    'closure.edgeName': '{from} ki {to}',
    'closure.venueNotice': '{text}',
    'error.noRouteClosed': 'Kāore he ara ki {name}: kua kati tētahi wāhanga o te ara.',
    'error.noRouteClosedHint':
      'Kua kati tētahi wāhanga e aukati ana i ngā ara katoa. Pātai ki ngā kaimahi.',

    // First-run permissions screen
    'firstRun.title': 'I mua i te tīmatanga',
    'firstRun.intro':
      'Ka ārahi tēnei taupānga i a koe huri noa i {venue} mā tō waea. E rua ngā whakaaetanga e hiahiatia ana:',
    'firstRun.camera.title': 'Kāmera',
    'firstRun.camera.why':
      'Hei kimi i tō wāhi mā te mōhio ki ngā tohu, ngā kūaha me ngā tohu whakaū e karapoti ana i a koe. Ka whakamahia te kāmera i te wā anake e tuwhera ana te tirohanga kāmera.',
    'firstRun.motion.title': 'Ngā pūoko nekehanga',
    'firstRun.motion.why':
      'Kia tika tonu te tohu o te pere i a koe e hīkoi ana i waenga i ngā whakatau kāmera.',
    'firstRun.data.title': 'Ngā mea ka wehe i tō waea',
    'firstRun.data.none': 'Kāore he mea. Ka rere te tautuhi wāhi i runga i tō waea.',
    'firstRun.data.item': '{data} → {destination}: {purpose}',
    'firstRun.never.title': 'Ngā mea kāore e kohia',
    'firstRun.never.body':
      'Kāore he wāhi GPS, kāore he pūkete, kāore he ingoa, kāore he whakaahua e tiakina ana, kāore he pānuitanga, kāore he tātari. Tirohia te pānui tūmataiti.',
    'firstRun.allow': 'Whakaae ki te kāmera me te nekehanga',
    'firstRun.floorplanOnly': 'Whakamahia te mahere papa anake',
    'firstRun.privacyLink': 'Pānui tūmataiti',
    'firstRun.requesting': 'E tono ana i tō waea mō te whakaaetanga…',
    'firstRun.motionDenied':
      'Kāore i whakaaetia te nekehanga. Tērā pea ka pōturi te pere i waenga i ngā whakatau kāmera.',
    'entry.anchorSeeded': 'E tīmata ana i te tohu {name}.',

    // Accuracy harness
    'harness.title': 'Whakamātautau tika',
    'harness.hint': 'E tū tika ki runga i tētahi wāhi tohu, kātahi ka pāwhiri.',
    'harness.checkpoints': 'Ngā wāhi tohu',
    'harness.here': 'Kei {name} ahau',
    'harness.recorded': 'Kua hopukina a {name} — {count} wāhi tohu i tēnei wā',
    'harness.poses': '{count} tū',
    'harness.rescan': 'Kua tonoa he matawai anō',
    'harness.download': 'Tikiake i te rangitaki',
    'harness.report': 'Whakaatu i te pūrongo',
    'harness.reset': 'Tautuhi anō',
    'harness.summary': 'Hapa toharite {mean} m, kino rawa {worst} m, whakatau rahua {failed}',

    // Admin
    'admin.title': 'Whakahaere wāhi',
    'admin.hint':
      'Hopukina ngā ara mā te hīkoi, pāwhiria rānei te mahere papa hei whakatakoto pona. Kaweake ina oti.',
    'admin.tab.record': 'Hopu ara',
    'admin.tab.plan': 'Ētita mahere',
    'admin.tab.export': 'Kaweake',
    'admin.record.start': 'Tīmata te hopu',
    'admin.record.stop': 'Whakamutu te hopu',
    'admin.record.addNode': 'Tāpiri pona ki konei',
    'admin.record.addPoi': 'Tāpiri wāhi ki konei',
    'admin.record.addAnchor': 'Tāpiri tohu QR ki konei',
    'admin.record.noPose':
      'E tatari ana mō tētahi wāhi — matawaia he tohu, whakamahia rānei te ētita mahere.',
    'admin.record.status': 'E hopu ana · {nodes} pona, {edges} hononga i tēnei hīkoi',
    'admin.record.added': 'Kua tāpiritia a {name}',
    'admin.record.snapped': 'Kua hono ki te pona {name}',
    'admin.plan.hint':
      'Pāwhiria hei tāpiri pona. Pāwhiria tētahi pona, kātahi tētahi atu, hei hono. Pāwhiria anō hei kōwhiri.',
    'admin.plan.selected': 'Kua kōwhiria a {name}',
    'admin.plan.link': 'Hono ki te pona ka pāwhiria',
    'admin.plan.remove': 'Tango pona',
    'admin.plan.rename': 'Whakaingoa anō',
    'admin.plan.floor': 'Papa',
    'admin.name.prompt': 'Ingoa',
    'admin.poi.name': 'Ingoa wāhi',
    'admin.poi.category': 'Kāwai',
    'admin.poi.aliases': 'Ētahi atu ingoa (wehea ki te piko)',
    'admin.anchor.heading': 'Anga i te matawai (tākiri)',
    'admin.undo': 'Wetekia',
    'admin.moreTools': 'Ētahi atu taputapu ▾',
    'admin.export.summary':
      '{floors} papa · {nodes} pona · {edges} hononga · {pois} wāhi · {anchors} tohu',
    'admin.export.valid': 'He JSON wāhi tika.',
    'admin.export.invalid': '{count} raruraru hei whakatika i mua i te kaweake:',
    'admin.export.download': 'Tikiake venue.json',
    'admin.export.copy': 'Tārua JSON',
    'admin.export.copied': 'Kua tāruatia.',
    'admin.export.downloaded':
      'Kua tiakina {name} — tirohia Ngā Kōnae (te whāriki tiri rānei) i tēnei pūrere.',
    'admin.export.discard': 'Whakakore i te tauira',
    'admin.export.rawJson': 'Whakaatuhia te JSON mata (mēnā kāore e mahi a Tikiake me Tārua)',
    'admin.export.rawJsonHint':
      'Pāwhiritia ki roto, tīpakohia katoatia, ka tāruatia ā-ringa — ka whakaatu tonu tēnei i te hukihuki o nāianei, ahakoa kāore ngā pātene i runga ake nei e mahi ana.',
    'admin.export.publish': 'Whakaputa mō te katoa',
    'admin.export.publishing': 'E whakaputa ana…',
    'admin.export.published':
      'Kua whakaputaina. Ka riro i ngā manuhiri tēnei putanga mai i nāianei.',
    'admin.export.publishFailed': 'I rahua te whakaputa: {message}',
    'admin.export.tokenPrompt': 'Kī whakaputa a te kaiwhakahaere',
    'admin.export.unconfigured':
      'Kāore anō te whakaputa kia whakaritea i tēnei tūmau (ADMIN_TOKEN).',
    'admin.export.unauthorised': 'Kāore i whakaaetia taua kī whakaputa.',
    'admin.export.devServer':
      'Me te pae kua tukuna te whakaputa; i te tūmau whakawhanake, tikiake i te kōnae.',
    'admin.tab.edit': 'Whakatika i te mea tīariari',
    'admin.edit.search': 'Kimihia he wāhi, he tohu rānei',
    'admin.edit.placeholder': 'hei tauira: wāri 4, tari manaaki, rūma ararewa',
    'admin.edit.kind.poi': 'Wāhi',
    'admin.edit.kind.anchor': 'Tohu QR',
    'admin.edit.none': 'Kāore he mea e hāngai ana.',
    'admin.edit.moveHere': 'Nekehia ki tōku wāhi',
    'admin.edit.moved': 'Kua nekehia a {name} ki tō wāhi',
    'admin.edit.remove': 'Tango',
    'admin.edit.removed': 'Kua tangohia a {name}',
    'admin.edit.saved': 'Kua tiakina a {name}',
    'admin.edit.markerId': 'Tautohu tohu {id} — ka mahi tonu ngā waehere kua tāia',
    'admin.edit.access': 'Ko wai ka kite',
    'admin.edit.access.public': 'Te katoa',
    'admin.edit.access.staff': 'Kaimahi anake',
    'admin.save': 'Tiaki',
    'admin.saved.local':
      'Kua tiakina ki tēnei waea mō “{id}” — {nodes} tohu · {edges} hononga · {pois} wāhi · {anchors} tohu waehere · kāore anō kia whakaputaina',
    'admin.saved.published':
      'Kua whakaputaina mō “{id}” — {nodes} tohu · {edges} hononga · {pois} wāhi · {anchors} tohu waehere · kei te katoa tēnei putanga',
    'admin.saved.noBackup':
      '⚠ Kei tēnei pūrere anake — Tikiakehia, Tāruatia, Whakaputahia rānei i mua i te kati i tēnei pae.',
    'admin.saved.now': 'Kua tiakina',
    'admin.ward.number': 'Tau wāri (1–99)',
    'admin.ward.name': 'Wāri {n}',
    'admin.collapse': 'Huna ngā utauta',
    'admin.expand': 'Whakaatu ngā utauta',
    'admin.record.scan': 'Matawaia he tohu hei whakaū i tōku wāhi',
    'admin.record.scanning': 'Tohua te kāmera ki tētahi tohu i te pakitara…',
    'admin.record.noPoseHint':
      'Kāore anō he wāhi. Pāwhiria te mahere papa kei reira koe e tū ana, matawaia rānei he tohu.',
    'admin.record.poseFromPlan':
      'Kua tautuhia te wāhi mai i te mahere — whakamahia ngā pātene "ki konei".',
    'admin.record.added.node': 'Kua tāpiritia te pona {name}',
    'admin.record.added.poi': 'Kua tāpiritia te wāhi {name}',
    'admin.record.added.anchor':
      'Kua tāpiritia te tohu QR {name}. Kei te ripa Kaweake tōna waehere.',
    'admin.record.walkList': 'Kua tāpiritia i tēnei hīkoi',
    'admin.record.register': 'Rēhita i tētahi waehere kua tāia ki konei',
    'admin.record.registering': 'Tohua te kāmera ki te waehere kua tāia hei rēhita ki tēnei wāhi…',
    'admin.record.registered': 'Kua rēhitatia te waehere hei tohu {name}',
    'admin.record.registerKnown': 'Kua noho kē taua waehere hei tohu {name}',
    'admin.export.markers': 'Ngā tohu QR ({count})',
    'admin.export.printSheet': 'Whakatuwhera i te pepa tā',
    'admin.export.noMarkers': 'Kāore anō he tohu — tāpirihia mā "Tāpiri tohu QR ki konei".',
    'admin.export.markerCode': 'Waehere: {text}',
    'notice.venueNew':
      'Wāhi hou “{id}” — kāore anō he mea kua whakaputaina. Rūritia, kātahi ka Whakaputa.',
    'scan.unrecognised': 'Ehara te waehere “{text}” i te tohu mō tēnei wāhi.',
    'scan.wrongVenue': 'Nō tētahi atu wāhi te waehere “{text}”.',
    'scan.recording': 'E hopu ana — {distance} m',
    'admin.tab.survey': 'Rūri pihi',
    'admin.tab.routes': 'Ngā ara',
    'admin.stride.title': 'Whakarite te takahanga',
    'admin.stride.hint':
      'Hīkoia he tawhiti kua ine, ā, ka whakaritea tō roa takahanga — ka tino tika ake ngā tohu i waenga i ngā waehere i te taunoa toharite.',
    'admin.stride.distance': 'Te tawhiti hei hīkoi (mita)',
    'admin.stride.start': 'Tīmata te hīkoi',
    'admin.stride.stop': 'Kua hīkoi au',
    'admin.stride.walking':
      'E hīkoi ana… pāwhiritia "Kua hīkoi au" i te mutunga o te tawhiti kua ine.',
    'admin.stride.counting': '{steps} ngā takahanga tae noa ki nāianei…',
    'admin.stride.tooFewSteps':
      '{steps} noa iho ngā takahanga — hīkoia he roa ake, ka whakamātau anō.',
    'admin.stride.saved':
      'Kua whakaritea te takahanga ki {m} m ({steps} takahanga i runga i te tawhiti kua ine).',
    'admin.stride.current': 'Takahanga o nāianei: {m} m.',
    'admin.stride.default': 'E whakamahia ana te takahanga taunoa (0.73 m).',
    'admin.stride.unavailable': 'Kāore ngā pūoko nekehanga e wātea ana i tēnei pūrere.',
    'admin.wizard.step.start': 'Tīmata',
    'admin.wizard.step.walk': 'Hīkoi',
    'admin.wizard.step.finish': 'Mutunga',
    'admin.wizard.step.done': 'Kua oti',
    'admin.wizard.existing': 'He wāhi kua mōhiotia rānei',
    'admin.wizard.existingNone': '— kāore —',
    'admin.wizard.unnamed': 'ingoa-kore',
    'admin.wizard.scanHere': 'Matawaia te waehere i konei',
    'admin.wizard.codeRecorded': 'Kua hopukina te waehere {code} ki tēnei wāhi',
    'admin.wizard.advanced':
      'Kōwhiringa anō (whakaingoa, kōwhiri wāhi, arawhata/ararewa, kāore he waehere…)',
    'admin.wizard.start.hint':
      'Kōwhiria rānei te wāhi mēnā kei te mōhiotia kē, whakaingoatia rānei. Pāwhiria te mahere hei tautuhi i te tūnga me te kore waehere.',
    'admin.wizard.start.name': 'Wāhi tīmata',
    'admin.wizard.start.next': 'Tīmata te hīkoi',
    'admin.wizard.start.noPose':
      'E tū ana koe ki te tīmatanga o tēnei ara, matawaia te waehere i reira.',
    'admin.wizard.start.scan': 'Matawaia te waehere tīmata',
    'admin.wizard.start.ready': 'Mā te matawai e whakaingoa, e tīmata hoki te ara.',
    'admin.wizard.start.readyApprox':
      'Kua tautuhia te tūnga mai i te mahere (tata) — matawaia he waehere kia tika ai te tīmatanga, whakatuwheratia rānei Kōwhiringa anō hei tīmata noa te hīkoi.',
    'admin.wizard.walk.status': '{distance} m · {points} tohu · {scans} waehere',
    'admin.wizard.walk.hint':
      'Hīkoi ki te wāhi e whai ake nei, kātahi ka matawai i te waehere i reira — ka mutu tēnei ara, ka tīmata te ara e whai ake nei.',
    'admin.wizard.walk.uncertain':
      'Kāore i te tino mōhiotia te tūnga — matawaia te waehere tata rawa hei whakatika. Kāore he tohu e tāpirihia tae noa ki reira.',
    'admin.wizard.walk.section': 'Ko te wāhanga e whai ake nei he',
    'admin.wizard.walk.staffOnly': 'Wāhanga mā ngā kaimahi anake',
    'admin.wizard.walk.turn': 'Tohua he hurihanga i konei',
    'admin.wizard.walk.scan': 'Matawaia te waehere hei whakamutu i konei',
    'admin.wizard.walk.arrive': 'Kua tae au',
    'admin.wizard.walk.cancel': 'Whakamutua tēnei ara',
    'admin.wizard.walk.cancelled':
      'Kua whakamutua te ara. Ka noho tonu ngā tohu kua tāpirihia — whakamahia a Wetekia hei tango.',
    'admin.wizard.section.walk': 'Hīkoi papatahi',
    'admin.wizard.section.door': 'Mā te kūaha',
    'admin.wizard.section.stairs': 'Arawhata',
    'admin.wizard.section.lift': 'Ararewa',
    'admin.wizard.section.ramp': 'Ara pīkau',
    'admin.wizard.section.escalator': 'Arawhata hiko',
    'admin.wizard.finish.hint':
      'Whakaingoatia te wāhi ka tae atu (ka kōwhiri rānei mēnā kei te mōhiotia kē), ā, matawaia te waehere i konei mēnā he waehere.',
    'admin.wizard.finish.name': 'Wāhi ka tae atu',
    'admin.wizard.finish.noWheelchair':
      'Kāore e pai mō te tūru wīra (kūaha whāiti, ara pīkau pari)',
    'admin.wizard.finish.needName':
      'Whakaingoatia te wāhi ka tae atu, kōwhiria rānei he wāhi kua mōhiotia.',
    'admin.wizard.finish.save': 'Tiakina te ara',
    'admin.wizard.done.summary': '{from} → {to}: {distance} m, {points} tohu, {scans} waehere',
    'admin.wizard.done.saved': 'Kua tiakina te ara ki te hukihuki.',
    'admin.wizard.done.nextHere': 'Ara e whai ake nei mai i konei',
    'admin.wizard.done.nextNew': 'Ara hou mai i wāhi kē',
    'admin.wizard.done.publish': 'Whakaputa…',
    'admin.survey.hint':
      'E tū ki tētahi waehere kua tāia, whakaingoatia te wāhi, kātahi ka matawai. Ka hopukina te waehere, tō wāhi me te wāhi ingoa — ka hono ki tērā o mua.',
    'admin.survey.name': 'Ingoa wāhi',
    'admin.survey.scan': 'Matawaia te waehere kua tāia',
    'admin.survey.scanning': 'Tohua te kāmera ki te waehere kua tāia…',
    'admin.survey.recorded': 'Kua hopukina a {name} — waehere {code}',
    'admin.survey.recordedNoName': 'Kua hopukina te waehere {code} ki tēnei wāhi',
    'admin.survey.known': 'Kua noho kē taua waehere hei {name}; kei reira koe ināianei.',
    'admin.survey.firstAtOrigin':
      'Kua hopukina te waehere tuatahi hei pūtake mahere (0, 0). Hīkoi ki te waehere e whai ake nei, ka matawai.',
    'admin.survey.count': '{count} waehere kua hopukina i tēnei rūri',
    'admin.survey.plan': 'Rārangi waehere kua tāia',
    'admin.survey.planHint':
      'Whakapiri te rārangi o ngā waehere i tāia e koe, kotahi ki ia rārangi: waehere, papa, wāhi (hei tauira A03, G, Tari tomokanga). Ka matawaia he waehere kei te rārangi, ka whakakīia tōna ingoa me tōna papa.',
    'admin.survey.planUse': 'Whakamahia tēnei rārangi',
    'admin.survey.planDemo': 'Utaina te rārangi hōhipera whakaaturanga (A01–A24)',
    'admin.survey.planStatus': '{done} o ngā waehere {total} kua hopukina',
    'admin.survey.planNext': 'e whai ake: {code} — {name} ({floor})',
    'admin.survey.planErrors': 'Kāore i taea te pānui i ngā rārangi {count}: {first}',
    'admin.draft.restored': 'Kua whakahokia te tauira mai i tēnei pūrere.',
    'admin.close': 'Kati te whakahaere',
    'admin.ok': 'Āe',
    'admin.cancel': 'Whakakore',

    // Landmarks
    'landmark.passing': 'E haere ana i {name}',
    'landmark.near': 'E tata ana ki {name}',
    'speech.landmark': 'E haere ana i {name}.',

    // Floors
    'floor.unknown': 'Papa tē mōhiotia',
  },
};
