function initialize() {
    // Set up initial map and street view
    const initialPosition = { lat: 42.345573, lng: -71.098326 }; // Default to Fenway

    const map = new google.maps.Map(document.getElementById("map"), {
        center: initialPosition,
        zoom: 14,
    });

    const panorama = new google.maps.StreetViewPanorama(
        document.getElementById("pano"),
        {
            position: initialPosition,
            pov: {
                heading: 34,
                pitch: 10,
            },
            motionTracking: true,
        }
    );

    map.setStreetView(panorama);

    // Use geolocation to get the current position
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const currentLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                };

                // Set the new position for the map and panorama
                map.setCenter(currentLocation);
                panorama.setPosition(currentLocation);

                // Load nearby places
                loadNearbyPlaces(map, currentLocation);
            },
            () => {
                console.error("Error retrieving geolocation");
            },
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 27000,
            }
        );
    } else {
        console.error("Geolocation is not supported by this browser.");
    }
}

// Function to load nearby places using Google Places API
async function loadNearbyPlaces(map, position) {
    const service = new google.maps.places.PlacesService(map);
    const request = {
        location: position,
        radius: '1500', // Search within 1.5 km radius
        type: ['restaurant', 'cafe', 'store'], // Types of places to search for
    };

    service.nearbySearch(request, (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK) {
            for (let i = 0; i < results.length; i++) {
                const place = results[i];
                createMarker(place);
            }
        } else {
            console.error('Places API request failed');
        }
    });
}

// Function to create a marker for each place
function createMarker(place) {
    const marker = new google.maps.Marker({
        map,
        position: place.geometry.location,
    });

    google.maps.event.addListener(marker, 'click', function () {
        const contentString = `
            <div>
                <h2>${place.name}</h2>
                <p>${place.vicinity}</p>
            </div>
        `;
        const infowindow = new google.maps.InfoWindow({
            content: contentString,
        });
        infowindow.open(map, marker);
    });
}

window.initialize = initialize;
