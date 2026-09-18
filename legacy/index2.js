// Function to fetch places from APIs
async function loadPlaces(position) {
    const params = {
        radius: 300, // Search places within this radius (in meters)
        clientId: 'UK32CEVITYO5AMHU3ZRAASDZ25QCODXPSJ2P0LW3ANSJ55E5',
        clientSecret: 'TZY0JD4AY2QZFNK124NEW2DGMRFVH34EHJ1CF1A42FTFIGHG',
        version: '20300101', // Foursquare versioning
        method: 'GET',
        headers: {
            accept: 'application/json',
            Authorization: 'fsq3G3x+p/7LzoDS8jxsrhOegdXrYM8uBuDL1bBauE75NfU='
        }
    };

    const corsProxy = 'https://cors-anywhere.herokuapp.com/';

    const url = `${corsProxy}https://api.foursquare.com/v2/venues/search?intent=checkin
        &ll=${position.latitude},${position.longitude}
        &radius=${params.radius}
        &client_id=${params.clientId}
        &client_secret=${params.clientSecret}
        &limit=30 
        &v=${params.version}`;

    try {
        const res = await fetch(url);
        const resp = await res.json();
        return resp.response.venues;
    } catch (err) {
        console.error('Error with places API', err);
    }
}

window.onload = () => {
    const scene = document.querySelector('a-scene');

    // Get current user location
    navigator.geolocation.getCurrentPosition(
        async function (position) {
            // Use the current position to load nearby places
            const places = await loadPlaces(position.coords);
            places.forEach((place) => {
                const latitude = place.location.lat;
                const longitude = place.location.lng;

                // Add place name
                const placeText = document.createElement('a-link');
                placeText.setAttribute('gps-new-entity-place', `latitude: ${latitude}; longitude: ${longitude};`);
                placeText.setAttribute('title', place.name);
                placeText.setAttribute('scale', '15 15 15');

                placeText.addEventListener('loaded', () => {
                    window.dispatchEvent(new CustomEvent('gps--new-entity-place-loaded'));
                });

                scene.appendChild(placeText);
            });
        },
        (err) => console.error('Error in retrieving position', err),
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 27000,
        }
    );
};
