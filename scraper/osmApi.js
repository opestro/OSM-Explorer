import axios from 'axios';

/**
 * Build Overpass QL query based on search parameters
 * @param {Object} params - Query parameters
 * @param {string} params.country - ISO 3166-1 country code
 * @param {string} params.area - Area name to search within
 * @param {string[]} params.tags - OSM tags to search for
 * @param {Object} params.countryBounds - Country boundary box
 * @returns {string} Overpass QL query
 */
function buildOSMQuery({ country, area, tags, countryBounds }) {
    if (area) {
        // Area-specific search
        const normalizedArea = area.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        
        return `
            [out:json][timeout:60];
            // Get area within country
            area["ISO3166-1"="${country}"]["admin_level"="2"]->.country;
            (
                // Search for administrative divisions (Wilaya, Daïra, Commune)
                area["name"~"^${area}$|${area}",i]["admin_level"~"^(4|6|8)$"](area.country);
                area["name:fr"~"^${area}$|${area}",i]["admin_level"~"^(4|6|8)$"](area.country);
                area["name:ar"~"^${area}$|${area}",i]["admin_level"~"^(4|6|8)$"](area.country);
                // Also search by place tag for cities
                area["place"~"city|town"]["name"~"^${area}$|${area}",i](area.country);
            )->.searchArea;
            // Search for amenities within the matched area
            (
                ${tags.map(tag => `
                    node["${tag}"](area.searchArea);
                    way["${tag}"](area.searchArea);
                `).join('\n                ')}
            );
            out body qt;
            >;
            out skel qt;
        `;
    } else {
        // Country-wide search
        return `
            [out:json][timeout:60];
            (
                ${tags.map(tag => `
                    node["${tag}"](${countryBounds.south},${countryBounds.west},${countryBounds.north},${countryBounds.east});
                    way["${tag}"](${countryBounds.south},${countryBounds.west},${countryBounds.north},${countryBounds.east});
                `).join('\n                ')}
            );
            out body qt;
            >;
            out skel qt;
        `;
    }
}

/**
 * Execute Overpass API query
 * @param {string} query - Overpass QL query
 * @returns {Promise<Object>} API response
 */
async function executeOSMQuery(query) {
    console.log('Executing query:', query);
    const response = await axios.get('https://overpass-api.de/api/interpreter', {
        params: { data: query }
    });
    console.log('Response received:', {
        elementCount: response.data.elements?.length || 0,
        timestamp: new Date().toISOString()
    });
    return response;
}

/**
 * Filter OSM elements based on criteria
 * @param {Array} elements - Raw OSM elements
 * @param {Object} filters - Filter criteria
 * @param {string} filters.area - Area name
 * @param {string[]} filters.tags - Required tags
 * @returns {Array} Filtered elements
 */
function filterOSMResults(elements = [], { area, tags }) {
    console.log('Filtering elements:', elements.length);
    return elements.filter(element => {
        // Check for name in any language
        const hasName = element.tags && (
            element.tags.name ||
            element.tags['name:en'] ||
            element.tags['name:fr'] ||
            element.tags['name:ar']
        );

        // Check for required tags
        const hasValidTag = element.tags && 
            tags.some(tag => element.tags[tag]);

        // Add city name if area is specified
        if (area && element.tags) {
            element.tags['addr:city'] = area;
        }

        const isValid = hasName && hasValidTag;
        console.log('Element:', element.id, 'hasName:', hasName, 'hasValidTag:', hasValidTag);
        return isValid;
    });
}

/**
 * Search OpenStreetMap data based on parameters
 * @param {Object} searchParams - Search parameters
 * @param {string} searchParams.country - Country code
 * @param {string} searchParams.area - Area name (optional)
 * @param {string[]} searchParams.tags - OSM tags to search
 * @returns {Promise<Object>} Search results
 */
async function searchOSMData({ country, area, tags }) {
    try {
        // Get country boundaries
        const countryBounds = await fetchCountryBoundaries(country);
        
        // Build and execute query
        const osmQuery = buildOSMQuery({ country, area, tags, countryBounds });
        const response = await executeOSMQuery(osmQuery);

        // Filter and process results
        const filteredResults = filterOSMResults(response.data.elements, { area, tags });

        return {
            version: response.data.version,
            generator: response.data.generator,
            elements: filteredResults
        };

    } catch (error) {
        console.error('Error in OSM search:', error);
        throw error;
    }
}

/**
 * Fetch country boundaries from Nominatim
 * @param {string} countryCode - ISO 3166-1 country code
 * @returns {Promise<Object>} Country boundaries
 */
async function fetchCountryBoundaries(countryCode) {
    try {
        const response = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: {
                country: countryCode,
                format: 'json',
                addressdetails: 1,
                limit: 1
            },
            headers: {
                'User-Agent': 'OSM Explorer/1.0'
            }
        });

        if (!response.data || response.data.length === 0) {
            throw new Error(`No boundary data found for country: ${countryCode}`);
        }

        const country = response.data[0];
        return {
            south: parseFloat(country.boundingbox[0]),
            north: parseFloat(country.boundingbox[1]),
            west: parseFloat(country.boundingbox[2]),
            east: parseFloat(country.boundingbox[3])
        };
    } catch (error) {
        console.error('Error fetching country boundaries:', error);
        throw error;
    }
}

export { searchOSMData }; 