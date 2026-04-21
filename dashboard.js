/**
 * Main entry point called by index.html
 */
function runDashboard(api, successCallback, errorCallback) {
    // Define the time range (e.g., last 30 days)
    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);

    // 1. Fetch Drivers and Exceptions simultaneously
    Promise.all([
        fetchDrivers(api),
        fetchExceptions(api, thirtyDaysAgo.toISOString(), now.toISOString())
    ])
    .then(([drivers, exceptions]) => {
        const processedData = processDriverStats(drivers, exceptions);
        
        // fleetSummary object required by your index.html
        const fleetSummary = calculateFleetSummary(processedData);
        
        successCallback(processedData, fleetSummary);
    })
    .catch(err => {
        console.error("Dashboard Error:", err);
        errorCallback(err);
    });
}

/**
 * Fetch all users marked as drivers
 */
function fetchDrivers(api) {
    return new Promise((resolve, reject) => {
        api.call("Get", {
            typeName: "User",
            search: { isDriver: true }
        }, resolve, reject);
    });
}

/**
 * Fetch exceptions (incidents) for the period
 */
function fetchExceptions(api, fromDate, toDate) {
    return new Promise((resolve, reject) => {
        api.call("Get", {
            typeName: "ExceptionEvent",
            search: {
                fromDate: fromDate,
                toDate: toDate
            }
        }, resolve, reject);
    });
}

/**
 * Logic to map incidents to drivers and calculate scores
 */
function processDriverStats(drivers, exceptions) {
    return drivers.map(driver => {
        // Filter exceptions for this specific driver
        const driverExceptions = exceptions.filter(ex => ex.device.id === driver.id || (ex.driver && ex.driver.id === driver.id));
        
        const speeding = driverExceptions.filter(ex => ex.rule.id === "RuleSpeedingId").length;
        const braking = driverExceptions.filter(ex => ex.rule.id === "RuleHardBrakingId").length;
        const accel = driverExceptions.filter(ex => ex.rule.id === "RuleHardAccelerationId").length;

        // Basic scoring logic: Start at 100, subtract 5 points per incident
        let score = 100 - (speeding * 5) - (braking * 3) - (accel * 3);
        score = Math.max(0, score); // Don't go below 0

        let grade = "A";
        if (score < 90) grade = "B";
        if (score < 80) grade = "C";
        if (score < 70) grade = "D";

        return {
            Name: `${driver.firstName} ${driver.lastName}`,
            Score: score,
            Grade: grade,
            vsPrevMo: "+0%", // Static for now, requires fetching another month of data
            YTD: score,
            vsYTD: "+0%",
            Miles: "N/A", // Requires LogRecord/Trip data calls
            Speeding: speeding,
            Braking: braking,
            Accel: accel,
            Distraction: 0,
            Phone: 0,
            Camera: 0
        };
    });
}

/**
 * Aggregate data for the top metric cards
 */
function calculateFleetSummary(rows) {
    const totalScore = rows.reduce((sum, r) => sum + r.Score, 0);
    const avgScore = rows.length > 0 ? Math.round(totalScore / rows.length) : 0;
    const totalIncidents = rows.reduce((sum, r) => sum + r.Speeding + r.Braking + r.Accel, 0);

    return {
        score30: avgScore,
        changePrev: "0%",
        scorePrev: avgScore,
        scoreYtd: avgScore,
        changeYtd: "0%",
        incidents30: totalIncidents,
        incidentsChange: "0",
        cameraEvents: 0,
        driverCount: rows.length
    };
}
