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
    'category.ward': 'Wards',

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

    // Admin: route recording and plan editing
    'admin.title': 'Venue admin',
    'admin.hint':
      'Record routes by walking, or tap the floor plan to place nodes. Export when done.',
    'admin.tab.record': 'Record a route',
    'admin.tab.plan': 'Plan editor',
    'admin.tab.export': 'Export',
    'admin.record.start': 'Start recording',
    'admin.record.stop': 'Stop recording',
    'admin.record.addNode': 'Add node here',
    'admin.record.addPoi': 'Add place here',
    'admin.record.addAnchor': 'Add QR marker here',
    'admin.record.noPose': 'Waiting for a position — scan a marker or use the plan editor.',
    'admin.record.status': 'Recording · {nodes} nodes, {edges} links on this walk',
    'admin.record.added': 'Added {name}',
    'admin.record.snapped': 'Joined existing node {name}',
    'admin.plan.hint':
      'Tap to add a node. Tap a node, then another, to link them. Tap a node again to select it.',
    'admin.plan.selected': 'Selected {name}',
    'admin.plan.link': 'Link to next tapped node',
    'admin.plan.remove': 'Remove node',
    'admin.plan.rename': 'Rename',
    'admin.plan.floor': 'Floor',
    'admin.name.prompt': 'Name',
    'admin.poi.name': 'Place name',
    'admin.poi.category': 'Category',
    'admin.poi.aliases': 'Other names (comma-separated)',
    'admin.anchor.heading': 'Heading when scanning (degrees)',
    'admin.undo': 'Undo',
    'admin.export.summary':
      '{floors} floors · {nodes} nodes · {edges} links · {pois} places · {anchors} markers',
    'admin.export.valid': 'Valid venue JSON.',
    'admin.export.invalid': '{count} problems to fix before export:',
    'admin.export.download': 'Download venue.json',
    'admin.export.copy': 'Copy JSON',
    'admin.export.copied': 'Copied.',
    'admin.export.discard': 'Discard draft',
    'admin.export.publish': 'Publish for everyone',
    'admin.export.publishing': 'Publishing…',
    'admin.export.published': 'Published. Visitors get this version from now on.',
    'admin.export.publishFailed': 'Publishing failed: {message}',
    'admin.export.tokenPrompt': 'Admin publishing key',
    'admin.export.unconfigured': 'Publishing is not set up on this server yet (ADMIN_TOKEN).',
    'admin.export.unauthorised': 'That publishing key was not accepted.',
    'admin.export.devServer':
      'Publishing needs the deployed site; on the dev server, download the file instead.',
    'admin.tab.edit': 'Edit existing',
    'admin.edit.search': 'Find a place or marker',
    'admin.edit.placeholder': 'e.g. ward 4, reception, lift lobby',
    'admin.edit.kind.poi': 'Place',
    'admin.edit.kind.anchor': 'QR marker',
    'admin.edit.none': 'Nothing matches.',
    'admin.edit.moveHere': 'Move to where I am',
    'admin.edit.moved': 'Moved {name} to your position',
    'admin.edit.remove': 'Remove',
    'admin.edit.removed': 'Removed {name}',
    'admin.edit.saved': 'Saved {name}',
    'admin.edit.markerId': 'Marker id {id} — printed codes stay valid',
    'admin.edit.access': 'Who can see it',
    'admin.edit.access.public': 'Everyone',
    'admin.edit.access.staff': 'Staff only',
    'admin.save': 'Save',
    'admin.saved.local': 'Saved on this phone · not yet published',
    'admin.saved.published': 'Published — everyone has this version',
    'admin.saved.now': 'Saved',
    'admin.ward.number': 'Ward number (1–99)',
    'admin.ward.name': 'Ward {n}',
    'admin.collapse': 'Hide tools',
    'admin.expand': 'Show tools',
    'admin.record.scan': 'Scan a marker to fix my position',
    'admin.record.scanning': 'Point the camera at a marker on the wall…',
    'admin.draft.restored': 'Draft restored from this device.',
    'admin.close': 'Close admin',
    'admin.ok': 'OK',
    'admin.cancel': 'Cancel',

    // Landmarks recognised while moving (map matching)
    'landmark.passing': 'Passing {name}',
    'landmark.near': 'Near {name}',
    'speech.landmark': 'Passing {name}.',

    // Floors
    'floor.unknown': 'Unknown floor',
  },
};
