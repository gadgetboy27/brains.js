/**
 * Basic Location-Based AR Demo
 *
 * This demo creates a simple red box AR object that appears north of your current location.
 * When GPS position is first detected, a box is placed 0.001 degrees (~111 meters) north
 * of your position.
 *
 * Requirements:
 * - Device with GPS capability
 * - Camera access permission
 * - Location access permission
 * - HTTPS connection
 */

window.onload = () => {
    // Flag to ensure we only add the test entity once
    let testEntityAdded = false;

    // Get the GPS camera element from the AR scene
    const el = document.querySelector('[gps-new-camera]');

    // Listen for GPS position updates
    el.addEventListener('gps-camera-update-position', e => {
        // Only execute once when GPS position is first acquired
        if(!testEntityAdded) {
            // Alert the user with their current GPS coordinates
            alert(`Got first GPS position: lon ${e.detail.position.longitude} lat ${e.detail.position.latitude}`);

            // Create a 3D box entity using A-Frame
            // Box will be added to north of initial GPS position
            const entity = document.createElement('a-box');

            // Set the size of the box (20x20x20 units)
            entity.setAttribute('scale', {
                x: 20,
                y: 20,
                z: 20
            });

            // Set the color to red
            entity.setAttribute('material', {color: 'red' });

            // Place the box at GPS coordinates slightly north of current position
            // 0.001 degrees latitude ≈ 111 meters north
            entity.setAttribute('gps-new-entity-place', {
                latitude: e.detail.position.latitude + 0.001,
                longitude: e.detail.position.longitude
            });

            // Add the entity to the AR scene
            document.querySelector('a-scene').appendChild(entity);
        }

        // Mark that we've added our test entity
        testEntityAdded = true;
    });
}
