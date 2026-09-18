/**
 * English — the reference language. Every key used anywhere in the UI must
 * exist here; other languages fall back to it key by key.
 *
 * `{name}`-style placeholders are interpolated by `t()`.
 */
export default {
  code: 'en',
  name: 'English',
  strings: {
    'app.title': 'Indoor wayfinding',

    // HUD
    'hud.noDestination': 'Choose a destination',
    'hud.destination': 'To {name}',
    'hud.distance': '{metres} m',
    'hud.distanceLong': '{metres} metres to go',
    'hud.nextTurn': 'Next: {name}',
    'hud.arrived': 'You have arrived at {name}',
    'hud.arrivedShort': 'Arrived',
    'hud.rescan.title': 'Position uncertain',
    'hud.rescan.body':
      'Point the camera at a sign, a doorway or a QR marker so we can find you again.',
    'hud.rescan.action': 'OK',
    'hud.error.retry': 'Try again',
    'hud.error.dismiss': 'Dismiss',
    'hud.floorChange.up': 'Go up to {floor} via the {via}',
    'hud.floorChange.down': 'Go down to {floor} via the {via}',
    'hud.changeDestination': 'Change destination',
    'hud.cancel': 'Stop navigation',

    // Errors (inline, never alert())
    'error.venueLoad': 'The venue map could not be loaded.',
    'error.cameraDenied': 'Camera access was declined. You can still use the floor plan view.',
    'error.noCamera': 'No camera was found on this device. Use the floor plan view instead.',
    'error.unsupported':
      'This browser cannot run camera positioning. Use the floor plan view instead.',
    'error.positioningExhausted':
      'We cannot work out where you are. Scan a QR marker or use the floor plan view.',
    'error.noRoute': 'No route to {name} with your current settings.',
    'error.noRouteHint': 'Try relaxing the accessibility filters or check opening hours.',
    'error.generic': 'Something went wrong: {message}',

    // Destination picker
    'picker.title': 'Where do you want to go?',
    'picker.searchLabel': 'Search destinations',
    'picker.searchPlaceholder': 'Search by name, e.g. “Clinic B” or “toilets”',
    'picker.clearSearch': 'Clear search',
    'picker.categories': 'Browse by category',
    'picker.allCategories': 'All',
    'picker.results': '{count} destinations',
    'picker.resultsOne': '1 destination',
    'picker.noResults': 'Nothing matches “{query}”.',
    'picker.floor': '{floor}',
    'picker.alias': 'Also known as {aliases}',
    'picker.select': 'Navigate to {name}',
    'picker.highContrast': 'High contrast',
    'picker.close': 'Close',
    'picker.language': 'Language',

    // Floor plan view
    'floorplan.title': 'Floor plan',
    'floorplan.floor': '{name}',
    'floorplan.you': 'You are here',
    'floorplan.destination': 'Destination',
    'floorplan.route': 'Route',
    'floorplan.noPose': 'Finding your position…',
    'floorplan.otherFloor': 'Your destination is on {name}.',
    'floorplan.summary':
      'Floor plan of {floor}. You are at {x}, {y} metres, facing {heading} degrees.',
    'floorplan.rotation': 'Map orientation',
    'floorplan.headingUp': 'Heading up',
    'floorplan.northUp': 'North up',

    // View switcher
    'view.ar': 'Camera view',
    'view.floorplan': 'Floor plan',
    'view.switchHint': 'Hold the phone up for the camera view, or down for the floor plan.',

    // Arrow
    'arrow.distance': '{metres} m',

    // Categories (display names for venue category keys)
    'category.clinic': 'Clinics',
    'category.facility': 'Facilities',
    'category.service': 'Services',
    'category.retail': 'Shops',
    'category.food': 'Food & drink',
    'category.exit': 'Exits',
    'category.staff': 'Staff',
    'category.other': 'Other',

    // Spoken guidance (Web Speech API); also mirrored to a live region.
    'speech.toggle': 'Voice guidance',
    'speech.on': 'Voice guidance on',
    'speech.off': 'Voice guidance off',
    'speech.rate': 'Speech rate',
    'speech.rate.slow': 'Slow',
    'speech.rate.normal': 'Normal',
    'speech.rate.fast': 'Fast',
    'speech.unsupported': 'Voice guidance is not available in this browser.',
    'speech.destinationSet': 'Navigating to {name}. {metres} metres to go.',
    'speech.nextStep': 'Continue {metres} metres to {name}.',
    'speech.floorChange.up': 'Go up to {floor} using the {via}.',
    'speech.floorChange.down': 'Go down to {floor} using the {via}.',
    'speech.arrived': 'You have arrived at {name}.',
    'speech.rescan': 'Position uncertain. Point the camera at a sign or a QR marker.',
    'speech.cancelled': 'Navigation stopped.',

    // Handled states (persistent notices; the floor plan stays usable)
    'notice.offline':
      'You are offline. The floor plan and routes still work; live positioning may not.',
    'notice.lowBattery': 'Battery is low. Switched to the floor plan to save power.',
    'notice.venueCached': 'Showing a saved copy of the venue map; it may be out of date.',
    'notice.cameraDenied':
      'Camera access was declined — using the floor plan. Positioning may be limited.',
    'notice.noPosition': 'Your position is not available. Routes start from the main entrance.',
    'error.venueLoadNoCache':
      'The venue map could not be loaded and no saved copy exists. Connect to the internet and try again.',

    // Runtime config: closures and hidden points of interest
    'closure.notice': 'Closed: {list}',
    'closure.item': '{name} ({reason})',
    'closure.itemNoReason': '{name}',
    'closure.edgeName': '{from} to {to}',
    'closure.venueNotice': '{text}',
    'error.noRouteClosed': 'No route to {name}: part of the way is closed.',
    'error.noRouteClosedHint': 'A closed section blocks every route. Ask staff for help.',

    // First-run permissions screen
    'firstRun.title': 'Before we start',
    'firstRun.intro':
      'This app guides you around {venue} using your phone. It needs two permissions:',
    'firstRun.camera.title': 'Camera',
    'firstRun.camera.why':
      'To work out where you are by recognising signs, doorways and markers around you. The camera is only used while the camera view is open.',
    'firstRun.motion.title': 'Motion sensors',
    'firstRun.motion.why':
      'To keep the arrow pointing the right way as you walk between camera fixes.',
    'firstRun.data.title': 'What leaves your phone',
    'firstRun.data.none': 'Nothing. Positioning runs on your phone.',
    'firstRun.data.item': '{data} → {destination}: {purpose}',
    'firstRun.never.title': 'What is never collected',
    'firstRun.never.body':
      'No GPS location, no account, no name, no photos are saved, no advertising or analytics. See the privacy notice for details.',
    'firstRun.allow': 'Allow camera and motion',
    'firstRun.floorplanOnly': 'Use the floor plan only',
    'firstRun.privacyLink': 'Privacy notice',
    'firstRun.requesting': 'Asking your phone for permission…',
    'firstRun.motionDenied': 'Motion access was declined. The arrow may lag between camera fixes.',
    'entry.anchorSeeded': 'Starting from the {name} marker.',

    // Accuracy harness (test walks)
    'harness.title': 'Accuracy test',
    'harness.hint': 'Stand exactly on a marked checkpoint, then tap it.',
    'harness.checkpoints': 'Checkpoints',
    'harness.here': 'I am at {name}',
    'harness.recorded': 'Recorded {name} — {count} checkpoints so far',
    'harness.poses': '{count} poses',
    'harness.rescan': 'Rescan requested',
    'harness.download': 'Download log',
    'harness.report': 'Show report',
    'harness.reset': 'Reset',
    'harness.summary': 'Mean error {mean} m, worst {worst} m, failed fixes {failed}',

    // Floors
    'floor.unknown': 'Unknown floor',
  },
};
