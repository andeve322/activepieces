import { createTrigger, TriggerStrategy, Property, PieceAuth } from '@activepieces/pieces-framework';
import { DedupeStrategy, Polling, pollingHelper } from '@activepieces/pieces-common';
import { ingvCommon } from '../common';

export const newEarthquake = createTrigger({
    name: 'new_earthquake',
    displayName: 'New Earthquake',
    description: 'Triggers when a new earthquake is detected in Italy.',
    type: TriggerStrategy.POLLING,
    auth: PieceAuth.None(),
    props: {
        minMagnitude: Property.Number({
            displayName: 'Minimum Magnitude',
            description: 'Filter events by minimum magnitude (e.g., 2.0).',
            required: false,
            defaultValue: 2.0,
        }),
    },
    sampleData: {
        id: 45689942,
        time: '2026-04-27T07:17:26.240000',
        magnitude: 0.7,
        magnitude_type: 'ML',
        place: '3 km SE Cerreto di Spoleto (PG)',
        latitude: 42.7948,
        longitude: 12.9402,
        depth_km: 9.2,
        url: 'https://terremoti.ingv.it/event/45689942',
    },
    async test({ auth, propsValue, store, files }) {
        return await pollingHelper.test(polling, {
            auth,
            store,
            propsValue,
            files,
        });
    },
    async onEnable({ auth, propsValue, store }) {
        await pollingHelper.onEnable(polling, {
            auth,
            store,
            propsValue,
        });
    },
    async onDisable({ auth, propsValue, store }) {
        await pollingHelper.onDisable(polling, {
            auth,
            store,
            propsValue,
        });
    },
    async run({ auth, propsValue, store, files }) {
        return await pollingHelper.poll(polling, {
            auth,
            store,
            propsValue,
            files,
        });
    },
});

const polling: Polling<undefined, { minMagnitude: number | undefined }> = {
    strategy: DedupeStrategy.LAST_ITEM,
    items: async ({ propsValue }) => {
        const response = await ingvCommon.fetchEvents({
            minMagnitude: propsValue.minMagnitude,
            limit: 50, // Poll last 50 events
        });

        return response.features.map((f) => ({
            id: f.properties.eventId.toString(),
            data: {
                id: f.properties.eventId,
                time: f.properties.time,
                magnitude: f.properties.mag,
                magnitude_type: f.properties.magType,
                place: f.properties.place,
                latitude: f.geometry.coordinates[1],
                longitude: f.geometry.coordinates[0],
                depth_km: f.geometry.coordinates[2],
                url: `https://terremoti.ingv.it/event/${f.properties.eventId}`,
            },
        }));
    },
};
