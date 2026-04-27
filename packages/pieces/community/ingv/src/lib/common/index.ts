import { HttpMethod, httpClient, HttpRequest } from '@activepieces/pieces-common';

export const ingvCommon = {
    baseUrl: 'http://webservices.ingv.it/fdsnws/event/1',
    async fetchEvents({ minMagnitude, starttime, limit }: { minMagnitude?: number; starttime?: string; limit?: number }) {
        const request: HttpRequest = {
            method: HttpMethod.GET,
            url: `${this.baseUrl}/query`,
            queryParams: {
                format: 'geojson',
                ...(minMagnitude ? { minmagnitude: minMagnitude.toString() } : {}),
                ...(starttime ? { starttime } : {}),
                ...(limit ? { limit: limit.toString() } : {}),
            },
        };

        const response = await httpClient.sendRequest(request);
        return response.body as INGVGeoJSON;
    },
};

export type INGVGeoJSON = {
    type: 'FeatureCollection';
    features: INGVFeature[];
};

export type INGVFeature = {
    type: 'Feature';
    properties: {
        eventId: number;
        originId: number;
        time: string;
        author: string;
        magType: string;
        mag: number;
        magAuthor: string;
        type: string;
        place: string;
        version: number;
        geojson_creationTime: string;
    };
    geometry: {
        type: 'Point';
        coordinates: [number, number, number]; // [lon, lat, depth]
    };
};
