import { createPiece, PieceAuth } from '@activepieces/pieces-framework';
import { PieceCategory } from '@activepieces/shared';
import { createCustomApiCallAction } from '@activepieces/pieces-common';
import { getRecentEarthquakes } from './lib/actions/get-recent-earthquakes';
import { newEarthquake } from './lib/triggers/new-earthquake';

export const ingv = createPiece({
    displayName: 'INGV Earthquakes',
    description: 'Monitor real-time earthquake data in Italy using official INGV API.',
    auth: PieceAuth.None(),
    minimumSupportedRelease: '0.36.1',
    logoUrl: 'https://cdn.activepieces.com/pieces/ingv.png',
    categories: [PieceCategory.PRODUCTIVITY],
    authors: [],
    actions: [
        getRecentEarthquakes,
        createCustomApiCallAction({
            baseUrl: () => 'http://webservices.ingv.it/fdsnws/event/1',
            auth: PieceAuth.None(),
            authMapping: async () => ({}),
        }),
    ],
    triggers: [newEarthquake],
});
