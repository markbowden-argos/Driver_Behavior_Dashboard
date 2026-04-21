/**
 * runDashboard
 * Logic: Fetches drivers and exceptions, then calculates scores.
 */
function runDashboard(api, successCallback, errorCallback) {
    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);

    // 1. Run parallel API calls for efficiency
    Promise.all([
        fetchDrivers(api),
        fetchExceptions(api, thirtyDaysAgo.toISOString(), now.toISOString())
    ])
    .then(([drivers, exceptions]) => {
        // 2. Map the Geotab data into the format your table expects
        const processedRows = drivers.map(driver => {
            // Filter incidents for this specific driver
            const driverEvents = exceptions.filter(ex => 
                (ex.driver && ex.driver.id === driver.id) || 
                (ex.device && ex.device.id === driver.id)
            );

            const speeding = driverEvents.filter(ex => ex.rule.id === "RuleSpeedingId").length;
            const braking  = driverEvents.filter(ex => ex.rule.id === "RuleHardBrakingId").length;
            const accel    = driverEvents.filter(ex => ex.rule.id === "RuleHardAccelerationId").length;

            // Simple Scoring Logic (Adjust weights as needed)
            let score = 100 - (speeding * 4) - (braking * 2) - (accel * 2);
            score = Math.max(0, score); // Ensure it doesn't go negative

            let grade = "A";
            if (score < 90) grade = "B";
            if (score < 80) grade = "C";
            if (score < 70) grade = "D";

            return {
                Name: (driver.firstName + " " + driver.lastName).trim() || driver.userName,
                Score: score,
                Grade: grade,
                vsPrevMo: "+0%", // Requires a 60-day fetch for comparison
                YTD: score,
                vsYTD: "+0%",
                Miles: "N/A", 
                Speeding: speeding,
                Braking: braking,
                Accel: accel,
                Distraction: 0,
                Phone: 0,
                Camera: 0
            };
        });

        // 3. Aggregate data for your metric cards
        const fleetSummary = {
            score30: processedRows.length > 0 
                ? Math.round(processedRows.reduce((a, b) => a + b.Score, 0) / processedRows.length) 
                : 0,
            changePrev: "0%",
            scoreYtd: 88, // Placeholder
            changeYtd: "+2%",
            incidents30: exceptions.length,
            driverCount: processedRows.length
        };

        successCallback(processedRows, fleetSummary);
    })
    .catch(err => {
        console.error("Geotab API Error:", err);
        errorCallback(err);
    });
}

/**
 * API Call: Get Users who are Drivers
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
 * API Call: Get Exception Events (Incidents)
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
