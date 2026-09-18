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

    // Floors
    'floor.unknown': 'Papa tē mōhiotia',
  },
};
