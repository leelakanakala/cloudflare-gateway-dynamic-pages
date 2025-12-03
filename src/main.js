import { getAssetFromKV } from "@cloudflare/kv-asset-handler";

/* eslint-disable */

addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  console.log("path name :", url.pathname )
  if (url.pathname === "/api/userdetails") {
    event.respondWith(handleUserDetails(event.request));
  } else if (url.pathname === "/api/history") {
    event.respondWith(handleHistoryRequest(event.request));
  } else if (url.pathname === "/api/debug") {
    event.respondWith(handleDebugPage(event.request));
  } else if (url.pathname === "/api/env") {
    event.respondWith(handleEnvRequest(event.request, event.env));
  } else if (url.pathname === "/api/upload") {
    event.respondWith(handleUploadRequest(event.request, event.env));
  } else if (url.pathname === "/assets/logo") {
    event.respondWith(handleAssetRetrieval(event.request, event.env, "logo"));
  } else if (url.pathname === "/manifest.json") {
    event.respondWith(handleManifestRequest(event.request));
  } else if (url.pathname === "/gateway") {
    event.respondWith(handleGatewayRedirectRequest(event));
  } else if (url.pathname === "/api/gateway") {
    event.respondWith(handleGatewayRuleMetadataRequest(event.request));
  } else {
    event.respondWith(handleEvent(event));
  }
});

// Expose worker env var via API endpoint (needed for frontend shenanigans)
// This also has the theme since its stored in kv upon configuration
const corsOrigin = CORS_ORIGIN;
const corsHeaders = {
  "Access-Control-Allow-Origin": corsOrigin,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// serve the environment config (configured in wrangler.toml) for the components to reference
// this includes worker settings, ui themeing
async function handleEnvRequest(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const themeKey = "theme";

  try {
    if (request.method === "POST") {
      const body = await request.json();

      // Update to only store primary and secondary colors
      const updatedTheme = {
        primaryColor: body.primaryColor || "#3498db", // Default for primary color
        secondaryColor: body.secondaryColor || "#2ecc71", // Default for secondary color
      };
      // eslint-disable-next-line
      await gw_custom_pages_kv.put(
        themeKey,
        JSON.stringify(updatedTheme)
      );

      return new Response(
        JSON.stringify({ message: "Theme updated successfully!" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (request.method === "GET") {
      const theme = await gw_custom_pages_kv.get(themeKey);

      // Update environment variables to include only primary and secondary colors
      const envVars = {
        ORGANIZATION_ID: ORGANIZATION_ID,
        ORGANIZATION_NAME: ORGANIZATION_NAME,
        TARGET_GROUP: TARGET_GROUP,
        DEBUG: DEBUG,
        SETUP: SETUP,
        theme: theme
          ? JSON.parse(theme)
          : {
              primaryColor: "#3498db", // Default for primary color
              secondaryColor: "#2ecc71", // Default for secondary color
            },
      };

      return new Response(JSON.stringify(envVars), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error("Error handling /api/env:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

/* eslint-enable */

async function handleUploadRequest(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const contentType = request.headers.get("Content-Type");
    console.log("Content-Type:", contentType);

    if (!contentType || !contentType.includes("multipart/form-data")) {
      console.error("Invalid content type");
      return new Response(JSON.stringify({ error: "Invalid content type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const formData = await request.formData();
    console.log("Form data received:", formData);

    const file = formData.get("file");
    const type = formData.get("type");

    console.log("File:", file);
    console.log("Type:", type);

    if (!file || !type) {
      console.error("File or type missing in upload");
      return new Response(
        JSON.stringify({ error: "File or type missing in upload" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!["image/png", "image/jpeg", "image/svg+xml"].includes(file.type)) {
      console.error("Unsupported file type:", file.type);
      return new Response(JSON.stringify({ error: "Unsupported file type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Save the file to KV
    const key = `${type}`;
    console.log(`Saving file to KV with key: ${key}`);

    await gw_custom_pages_kv.put(key, file.stream(), {
      metadata: { contentType: file.type },
    });

    console.log("File uploaded successfully to KV:", key);

    return new Response(
      JSON.stringify({ message: `${type} uploaded successfully` }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error handling image upload:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to upload image",
        details: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}

async function handleAssetRetrieval(request, env, key) {
  try {
    // Access the KV namespace via env
    const asset = await gw_custom_pages_kv.getWithMetadata(key, {
      type: "stream",
    });

    if (!asset || !asset.value) {
      return new Response("Not Found", { status: 404 });
    }

    return new Response(asset.value, {
      headers: {
        "Content-Type":
          asset.metadata?.contentType || "application/octet-stream",
      },
    });
  } catch (error) {
    console.error(`Error retrieving asset "${key}":`, error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

// https://developers.cloudflare.com/cloudflare-one/policies/gateway/http-policies/#redirect
async function handleGatewayRedirectRequest(event) {
  try {
    return await getAssetFromKV(event, {
      mapRequestToAsset: (req) =>
        new Request(`${new URL(req.url).origin}/index.html`, req),
    });
  } catch (error) {
    console.error("Error serving React app for /gateway:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

// handle enhanced gateway policy information - description in /gateway messaging
async function handleGatewayRuleMetadataRequest(request) {
  const url = new URL(request.url);
  const ruleId = url.searchParams.get("rule_id");

  if (!ruleId) {
    return new Response(
      JSON.stringify({ error: "Missing rule_id query parameter" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const ruleUrl = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/gateway/rules/${ruleId}`;

  try {
    const response = await fetch(ruleUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${BEARER_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Error fetching rule metadata:", data);
      return new Response(JSON.stringify(data), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Unexpected error in /api/gateway:", error);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}


// handle the /api/debug endpoint
async function handleDebugPage(request) {
  try {
    // Check if debugging is enabled
    const isDebugEnabled = String(DEBUG).toLowerCase() === "true";

    if (isDebugEnabled) {
      const identityResponse = await fetchIdentity(request);

      if (!identityResponse.ok) {
        return new Response(
          JSON.stringify({ error: "Failed to fetch identity." }),
          {
            status: identityResponse.status,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const identityData = await identityResponse.json();

      return new Response(JSON.stringify(identityData), {
        headers: { "Content-Type": "application/json" },
      });
    } else {
      return new Response(JSON.stringify({ error: "Debugging is disabled." }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ error: `Internal Server Error: ${error.message}` }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// handle static pages
async function handleEvent(event) {
  const url = new URL(event.request.url);

  try {
    if (url.pathname.startsWith("/assets/")) {
      const key = url.pathname.replace("/assets/", ""); // Extract the key
      const asset = await gw_custom_pages_kv.getWithMetadata(key, {
        type: "stream",
      });

      if (!asset || !asset.value) {
        return new Response("Not Found", { status: 404 });
      }

      return new Response(asset.value, {
        headers: {
          "Content-Type":
            asset.metadata?.contentType || "application/octet-stream",
        },
      });
    }

    return await getAssetFromKV(event);
  } catch (error) {
    if (error.message.includes("could not find")) {
      const options = {
        mapRequestToAsset: (req) =>
          new Request(`${url.origin}/index.html`, req),
      };
      return await getAssetFromKV(event, options);
    }
    return new Response(error.message || "Unknown error", {
      status: error.status || 500,
    });
  }
}

//old
// handle /api/userdetails + include user uuid for graphql
// async function handleUserDetails(request) {
//   // Step 1: Attempt to get device_id directly from the token
//   const accessCookie = request.headers.get("cf-access-jwt-assertion");
//   if (!accessCookie) {
//     return new Response(JSON.stringify({ error: "Unauthorized" }), {
//       status: 401,
//     });
//   }

//   // Try to extract device_id from the token
//   let device_id = getDeviceIdFromToken(accessCookie);

//   if (!device_id) {
//     console.warn(
//       "Device ID not found in token, attempting to fetch from get-identity"
//     );

//     // Step 2: Fallback - fetch identity data from get-identity endpoint to retrieve device_id
//     const identityResponse = await fetchIdentity(request);
//     if (!identityResponse.ok) {
//       return identityResponse;
//     }

//     const identityData = await identityResponse.json();
//     device_id = identityData?.identity?.device_id; // Get device_id from identity data

//     if (!device_id) {
//       return new Response(
//         JSON.stringify({ error: "Device ID not found in identity data" }),
//         { status: 400 }
//       );
//     }
//   }

//   try {
//     // Proceed with the fetched or fallback device_id
//     const identityResponse = await fetchIdentity(request);
//     if (!identityResponse.ok) {
//       return identityResponse;
//     }


//     const identityData = await identityResponse.json();
//     const deviceDetailsResponse = await fetchDeviceDetails(
//       identityData.gateway_account_id,
//       device_id
//     );
//         console.log("main gateway_account_id, ", identityData.gateway_account_id);

//     let deviceDetailsData = {};
//     if (deviceDetailsResponse.ok) {
//       deviceDetailsData = await deviceDetailsResponse.json();
//     } else if (deviceDetailsResponse.status === 404) {
//       console.warn(
//         `Device with ID ${device_id} not found (404). Device details unavailable.`
//       );
//     } else {
//       return deviceDetailsResponse;
//     }

//     const devicePostureResponse = await fetchDevicePosture(
//       identityData.gateway_account_id,
//       device_id
//     );

//     let devicePostureData = {};
//     if (devicePostureResponse.ok) {
//       devicePostureData = await devicePostureResponse.json();
//     } else {
//       console.warn(
//         `Device posture could not be retrieved for device ID ${device_id}.`
//       );
//     }

//     const combinedData = {
//       identity: identityData,
//       device: deviceDetailsData,
//       posture: devicePostureData,
//     };

//     return new Response(JSON.stringify(combinedData), {
//       headers: { "Content-Type": "application/json" },
//     });
//   } catch (error) {
//     console.error("Error in handleUserDetails:", error);
//     return new Response(
//       JSON.stringify({ error: `Internal Server Error: ${error.message}` }),
//       {
//         status: 500,
//         headers: { "Content-Type": "application/json" },
//       }
//     );
//   }
// }

// handle /api/userdetails + include user uuid for graphql
async function handleUserDetails(request) {
  const accessCookie = request.headers.get("cf-access-jwt-assertion");
  console.log("Device cookie", accessCookie);
  
  if (!accessCookie) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let device_id = getDeviceIdFromToken(accessCookie);
  let deviceIdError = null;

  if (!device_id) {
    console.warn("Device ID not found in token, attempting to fetch from get-identity");

    const identityResponse = await fetchIdentity(request);
    if (!identityResponse.ok) {
      console.error("Failed to fetch identity data:", identityResponse.status);
      return new Response(JSON.stringify({ error: "Failed to retrieve identity data" }), {
        status: identityResponse.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const identityData = await identityResponse.json();
    device_id = identityData?.identity?.device_id || null;

    if (!device_id) {
      console.warn("Device ID not found in identity data.");
      deviceIdError = "Device ID not found in identity data";
    }
  }

  try {
    const identityResponse = await fetchIdentity(request);
    if (!identityResponse.ok) {
      return new Response(JSON.stringify({ error: "Failed to retrieve identity data" }), {
        status: identityResponse.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    const identityData = await identityResponse.json();

    let deviceDetailsData = {};
    let devicePostureData = {};

    if (device_id) {
      const deviceDetailsResponse = await fetchDeviceDetails(identityData.gateway_account_id, device_id);
      if (deviceDetailsResponse.ok) {
        deviceDetailsData = await deviceDetailsResponse.json();
      } else if (deviceDetailsResponse.status === 404) {
        console.warn(`Device with ID ${device_id} not found (404). Device details unavailable.`);
      } else {
        console.error("Error fetching device details:", deviceDetailsResponse.status);
      }

      const devicePostureResponse = await fetchDevicePosture(identityData.gateway_account_id, device_id);
      if (devicePostureResponse.ok) {
        devicePostureData = await devicePostureResponse.json();
      } else {
        console.warn(`Device posture could not be retrieved for device ID ${device_id}.`);
      }
    }

    const combinedData = {
      identity: identityData,
      device: deviceDetailsData,
      posture: devicePostureData,
      ...(deviceIdError ? { warning: deviceIdError } : {}), // Append warning if device_id is missing
    };

    return new Response(JSON.stringify(combinedData), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in handleUserDetails:", error);
    return new Response(
      JSON.stringify({ error: `Internal Server Error: ${error.message}` }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// This is to assist handleUserDetails - getting the deviceid directly from the cfauth cookie
// function getDeviceIdFromToken(jwt) {
//   // eslint-disable-next-line
//   const [header, payload, signature] = jwt.split(".");
//   if (payload) {
//     try {
//       const decoded = JSON.parse(
//         atob(payload.replace(/_/g, "/").replace(/-/g, "+"))
//       );
//       return decoded.device_id || null; // Return device_id or null if not found
//     } catch (error) {
//       console.error("Error decoding JWT for device_id extraction:", error);
//     }
//   }
//   return null;
// }

// Improved JWT parsing function with safer error handling
function getDeviceIdFromToken(jwt) {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) throw new Error("Invalid JWT structure");

    const decoded = JSON.parse(
      atob(payload.replace(/_/g, "/").replace(/-/g, "+"))
    );
    return decoded.device_id || null;
  } catch (error) {
    console.error("Error decoding JWT for device_id extraction:", error);
    return null;
  }
}

// get-identity
async function fetchIdentity(request, retries = 1) {
  const accessCookie = request.headers.get("cf-access-jwt-assertion");
  if (!accessCookie) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  // eslint-disable-next-line
  const url = `https://${ORGANIZATION_NAME}.cloudflareaccess.com/cdn-cgi/access/get-identity`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: `CF_Authorization=${accessCookie}`,
      },
    });

    const textResponse = await response.text();

    // Check if the response is valid JSON
    try {
      const jsonResponse = JSON.parse(textResponse);
      return new Response(JSON.stringify(jsonResponse), {
        status: response.status,
      });
    } catch (e) {
      console.error("Received invalid JSON, attempting retry...", e);

      if (retries > 0) {
        // Retry fetchIdentity if response is not valid JSON
        return await fetchIdentity(request, retries - 1);
      } else {
        return new Response(
          JSON.stringify({ error: "Failed to fetch identity after retrying." }),
          { status: 500 }
        );
      }
    }
  } catch (error) {
    console.error("Error fetching identity:", error);
    return new Response(
      JSON.stringify({ error: `Failed to fetch identity: ${error.message}` }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// api -> device information
async function fetchDeviceDetails(gateway_account_id, device_id) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${gateway_account_id}/devices/${device_id}`;
  console.log(`Attempting to fetch device details from URL: ${url}`); // Log the request URL

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        // eslint-disable-next-line
        Authorization: `Bearer ${BEARER_TOKEN}`,
      },
    });

    console.log(`Device details response status: ${response.status}`);
    if (!response.ok) {
      const errorText = await response.clone().text();
      console.error(
        `Failed to fetch device details for device_id ${device_id}:`,
        errorText
      );
      return response;
    }

    const deviceDetails = await response.json();
    console.log(
      `Fetched device details for device_id ${device_id}:`
      // deviceDetails
    );

    return new Response(JSON.stringify(deviceDetails), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(
      `Error fetching device details for device_id ${device_id}:`,
      error.message
    );
    return new Response(
      JSON.stringify({ error: `Internal Server Error: ${error.message}` }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// api -> posture information
async function fetchDevicePosture(gateway_account_id, device_id) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${gateway_account_id}/devices/${device_id}/posture/check?enrich=false`;

  try {
    console.log(`Fetching device posture for device_id ${device_id}`);
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        // eslint-disable-next-line
        Authorization: `Bearer ${BEARER_TOKEN}`,
      },
    });

    if (!response.ok) {
      console.error(
        `Failed to fetch device posture for device_id ${device_id}:`,
        await response.text()
      );
      return response;
    }

    const devicePosture = await response.json();
    console.log(
      `Fetched device posture for device_id ${device_id}:`
      // devicePosture
    );

    return new Response(JSON.stringify(devicePosture), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(
      `Error fetching device posture for device_id ${device_id}:`,
      error.message
    );
    return new Response(
      JSON.stringify({ error: `Internal Server Error: ${error.message}` }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// graphql
// https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-access-login-events/
async function handleHistoryRequest(request) {
  try {
    // Fetch user details to get `user_uuid` - will be used to filter
    const userDetailsResponse = await handleUserDetails(request);
    const userDetailsData = await userDetailsResponse.json();
    const userUuid = userDetailsData.identity?.user_uuid;

    if (!userUuid) {
      return new Response(JSON.stringify({ error: "user_uuid not found" }), {
        status: 400,
      });
    }

    /* eslint-disable */

    const query = `
      query {
        viewer {
          accounts(filter: {accountTag: "${ACCOUNT_ID}"}) {
            accessLoginRequestsAdaptiveGroups(
              limit: 5, 
              filter: {
                datetime_geq: "${new Date(Date.now() - 10 * 60000).toISOString()}", 
                datetime_leq: "${new Date().toISOString()}", 
                userUuid: "${userUuid}", 
                isSuccessfulLogin: 0
              },
              orderBy: [datetime_DESC]
            ) {
              dimensions {
                datetime
                isSuccessfulLogin
                hasWarpEnabled
                hasGatewayEnabled
                ipAddress
                userUuid
                identityProvider
                country
                deviceId
                mtlsStatus
                approvingPolicyId
                appId
              }
            }
          }
        }
      }`;

    // Send request to Cloudflare's GraphQL API
    const response = await fetch(
      "https://api.cloudflare.com/client/v4/graphql",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${BEARER_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to fetch history data:", errorText);
      return new Response(
        JSON.stringify({ error: "Failed to fetch history data" }),
        { status: 500 }
      );
    }

    const data = await response.json();
    const loginEvents =
      data?.data?.viewer?.accounts[0]?.accessLoginRequestsAdaptiveGroups || [];

    // Now, because we only have appId in graphQL, make another api request to get the readable name
    const appNames = await Promise.all(
      loginEvents.map(async (event) => {
        const appId = event.dimensions.appId;
        if (appId) {
          const appUrl = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/access/apps/${appId}`;
          try {
            const appResponse = await fetch(appUrl, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${BEARER_TOKEN}`,
                "Content-Type": "application/json",
              },
            });

            if (appResponse.ok) {
              const appData = await appResponse.json();
              // console.log("App Data:", appData);
              return appData.result?.name || "Unknown App";
            } else {
              console.error(`Failed to fetch app name for appId ${appId}`);
              return "Unknown App";
            }
          } catch (error) {
            console.error(`Error fetching app name for appId ${appId}:`, error);
            return "Unknown App";
          }
        }
        return "No AppId";
      })
    );

    // Append the name to entry in the history endpoint
    const enhancedLoginEvents = loginEvents.map((event, index) => ({
      ...event,
      applicationName: appNames[index],
    }));
    /* eslint-disable */
    return new Response(JSON.stringify({ loginHistory: enhancedLoginEvents }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in handleHistoryRequest:", error);
    return new Response(
      JSON.stringify({ error: `Internal Server Error: ${error.message}` }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

async function handleManifestRequest(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const manifest = {
    name: "Access Helper",
    short_name: "AccessHelper",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    icons: [
      {
        sizes: "512x512",
        type: "image/png"
      }
    ]
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    }
  });
}