import { createAction, Property } from '@activepieces/pieces-framework';
import { ingvCommon } from '../common';

export const getRecentEarthquakes = createAction({
    name: 'get_recent_earthquakes',
    displayName: 'Get Recent Earthquakes',
    description: 'Fetch a list of recent earthquakes in Italy.',
    props: {
        minMagnitude: Property.Number({
            displayName: 'Minimum Magnitude',
            description: 'Filter events by minimum magnitude (e.g., 2.0).',
            required: false,
            defaultValue: 2.0,
        }),
        limit: Property.Number({
            displayName: 'Limit',
            description: 'Number of events to fetch.',
            required: false,
            defaultValue: 10,
        }),
    },
    async run(context) {
        const { minMagnitude, limit } = context.propsValue;
        const response = await ingvCommon.fetchEvents({
            minMagnitude,
            limit,
        });

        return response.features.map((f) => ({
            id: f.properties.eventId,
            time: f.properties.time,
            magnitude: f.properties.mag,
            magnitude_type: f.properties.magType,
            place: f.properties.place,
            latitude: f.geometry.coordinates[1],
            longitude: f.geometry.coordinates[0],
            depth_km: f.geometry.coordinates[2],
            url: `https://terremoti.ingv.it/event/${f.properties.eventId}`,
        }));
    },
});
