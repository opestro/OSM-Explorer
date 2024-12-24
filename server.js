import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { searchOSMData } from './scraper/osmApi.js';
import axios from 'axios';

const app = express();

/**
 * Express middleware configuration
 * - CORS for cross-origin requests
 * - JSON body parser
 * - URL-encoded body parser
 * - Static file serving
 */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

/**
 * Search endpoint for OpenStreetMap data
 * @route GET /search
 * @param {string} country - ISO 3166-1 country code
 * @param {string} area - Optional area/city name
 * @param {string} tags - Comma-separated list of OSM tags
 */
app.get('/search', async (req, res) => {
    const { country, area, tags } = req.query;
    
    try {
        // Log incoming request
        console.log('Received search request:', {
            country,
            area,
            tags,
            timestamp: new Date().toISOString()
        });
        
        // Validate required parameters
        if (!country || !tags) {
            console.log('Missing required parameters');
            return res.status(400).json({ 
                success: false, 
                error: 'Country and tags are required' 
            });
        }

        // Prepare search parameters
        const searchParams = {
            country,
            area: area || null,
            tags: tags.split(',')
        };

        // Execute OSM search
        console.log('Processing search for:', searchParams);
        const osmData = await searchOSMData(searchParams);
        
        // Log search completion
        console.log('Search completed:', {
            resultsFound: osmData.elements?.length || 0,
            timestamp: new Date().toISOString()
        });
        
        // Handle no results case
        if (!osmData.elements || osmData.elements.length === 0) {
            console.log('No results found for query');
            return res.json({
                success: true,
                message: 'No results found',
                elements: [],
                debug: {
                    area,
                    tags: searchParams.tags,
                    timestamp: new Date().toISOString()
                }
            });
        }

        // Send successful response
        console.log('Sending response with results');
        res.json({
            success: true,
            message: `Found ${osmData.elements.length} results`,
            debug: {
                area,
                tags: searchParams.tags,
                resultCount: osmData.elements.length,
                timestamp: new Date().toISOString()
            },
            ...osmData
        });

    } catch (error) {
        // Handle and log errors
        console.error('Search error:', {
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: error.response?.data || 'No additional details',
            debug: {
                searchParams: { country, area, tags: tags?.split(',') },
                errorTimestamp: new Date().toISOString()
            }
        });
    }
});

/**
 * Get list of all available countries
 * @route GET /api/countries
 * @returns {Object[]} Array of country objects with code, name, and languages
 */
app.get('/api/countries', async (req, res) => {
    try {
        // Fetch countries from REST Countries API
        const response = await axios.get('https://restcountries.com/v3.1/all');
        
        // Format country data
        const countries = response.data
            .map(country => ({
                code: country.cca2,
                name: country.name.common,
                languages: country.languages ? Object.values(country.languages) : []
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        res.json(countries);
    } catch (error) {
        console.error('Error fetching countries:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch country list',
            details: error.message
        });
    }
});

/**
 * Get specific country details including boundaries
 * @route GET /api/countries/:code
 * @param {string} code - ISO 3166-1 country code
 * @returns {Object} Country details including name and boundary box
 */
app.get('/api/countries/:code', async (req, res) => {
    try {
        const { code } = req.params;
        
        // Get country name from REST Countries API
        const countryResponse = await axios.get(`https://restcountries.com/v3.1/alpha/${code}`);
        const countryName = countryResponse.data[0].name.common;

        // Get boundaries from Nominatim
        const nominatimResponse = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: {
                country: code,
                format: 'json',
                addressdetails: 1,
                limit: 1
            },
            headers: {
                'User-Agent': 'OSM Explorer/1.0'
            }
        });

        if (!nominatimResponse.data || nominatimResponse.data.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Country boundaries not found'
            });
        }

        // Format and return country data
        const boundaryData = nominatimResponse.data[0];
        res.json({
            code: code.toUpperCase(),
            name: countryName,
            bounds: {
                south: parseFloat(boundaryData.boundingbox[0]),
                north: parseFloat(boundaryData.boundingbox[1]),
                west: parseFloat(boundaryData.boundingbox[2]),
                east: parseFloat(boundaryData.boundingbox[3])
            }
        });
    } catch (error) {
        console.error('Error fetching country details:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch country details',
            details: error.message
        });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 