import fetch from "node-fetch";

// fetch() makes HTTP requests to external APIs
// It returns a Promise, so we use await
// .json() parses the response body from JSON string to JS object
export async function getWeather({ city }) {
    try {
        const apiKey = process.env.OPENWEATHER_API_KEY;
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric`;

        const response = await fetch(url);

        if (!response.ok) {
            return `Error: Could not get weather for ${city}. Status: ${response.status}`;
        }

        const data = await response.json();
        return `Weather in ${city}: ${data.weather[0].description}, Temp: ${data.main.temp}°C, Humidity: ${data.main.humidity}%`;

    } catch (error) {
        // Network errors, DNS failures etc
        return `Error: Weather service unavailable. ${error.message}`;
    }
}