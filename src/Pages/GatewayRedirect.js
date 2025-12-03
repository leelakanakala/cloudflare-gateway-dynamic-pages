import React, { useEffect, useState } from "react";
import { MutatingDots } from "react-loader-spinner";
import Alert from "../components/alert";
import Button from "../components/button";


const GatewayRedirect = () => {
  const [contextData, setContextData] = useState(null);
  const [ruleData, setRuleData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ruleError, setRuleError] = useState(null); // if theres no cf_rule_id present
  const [debugEnabled, setDebugEnabled] = useState(false); // debug only detailed rule information from the api
  const [primaryColor, setPrimaryColor] = useState("#ffadfc"); // theme
  const [secondaryColor, setSecondaryColor] = useState("#a30adb"); // theme
  const [copied, setCopied] = useState(false); // copy/paste tooltip for the context info
  const [copiedRule, setCopiedRule] = useState(false); // copy/paste tooltip for the rule details
  const isMobile = false;

  const [bugsPolicyIds, setBugsPolicyIds] = useState([
    "1-2-3", // example test page policy
    "4-5-6", // Block DNS Security Categories
    "7-8-9" // Block Network Security Categories
  ]);

   // EXCLUSIONS — if the rule id IS in this list -> no CTAs at all (no Radar, no Bugs)
  const [excludedPolicyIds, setExcludedPolicyIds] = useState([
    // "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" // put any default exclusions here if desired
  ]);

  const [bugsTicketUrlBase, setBugsTicketUrlBase] = useState(
    "https://jira.0secuirty.net"
  );
  const [showBugsCta, setShowBugsCta] = useState(false);
  const [bugsTicketHref, setBugsTicketHref] = useState("");

    // --- helpers ---
  const parseMaybeCsvOrArray = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === "string") {
      return value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
  };

  useEffect(() => {
    const init = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const context = {};
        for (const [key, value] of params.entries()) {
          context[key] = value;
        }
        setContextData(context);

        // Fetch /api/env for theming + env (debug)
        const envRes = await fetch("/api/env", { credentials: "include" });
        const envData = await envRes.json();

        setDebugEnabled(envData.DEBUG === "true");

        if (envData.theme) {
          if (envData.theme.primaryColor) setPrimaryColor(envData.theme.primaryColor);
          if (envData.theme.secondaryColor) setSecondaryColor(envData.theme.secondaryColor);
        }

        // BUGS (allowlist) configuration
        if (envData.bugs) {
          const policyIds = Array.isArray(envData.bugs.policyIds)
            ? envData.bugs.policyIds
            : typeof envData.bugs.policyIds === "string"
            ? envData.bugs.policyIds
            : null;

          if (policyIds) setBugsPolicyIds(parseMaybeCsvOrArray(policyIds));

          if (typeof envData.bugs.ticketUrl === "string" && envData.bugs.ticketUrl.length > 0) {
            setBugsTicketUrlBase(envData.bugs.ticketUrl);
          }
        }

        // EXCLUSIONS configuration
        if (envData.exclusions) {
          const exIds = Array.isArray(envData.exclusions.policyIds)
            ? envData.exclusions.policyIds
            : typeof envData.exclusions.policyIds === "string"
            ? envData.exclusions.policyIds
            : null;

          if (exIds) setExcludedPolicyIds(parseMaybeCsvOrArray(exIds));
        }

        // Fetch rule data if cf_rule_id exists
        if (context.cf_rule_id) {
          const ruleRes = await fetch(
            `/api/gateway?rule_id=${encodeURIComponent(context.cf_rule_id)}`,
            { credentials: "include" }
          );
          if (!ruleRes.ok) throw new Error("Failed to fetch rule metadata");
          const ruleJson = await ruleRes.json();
          setRuleData(ruleJson);
        }
      } catch (err) {
        console.error("Failed during init:", err);
        setRuleError("Failed to load rule or environment info.");
      } finally {
        setLoading(false);
      }
    };

    init();
  }, []);


  useEffect(() => {
    const ruleId = contextData?.cf_rule_id;

    // Exclusion takes absolute precedence: no actions of any kind.
    if (ruleId && excludedPolicyIds.includes(ruleId)) {
      setShowBugsCta(false); // does not matter; CTAs won't render when excluded
      return;
    }

    // If rule is in the allowlist, show Radar CTAs (not Bugs)
    const isAllowlisted = Boolean(ruleId && bugsPolicyIds.includes(ruleId));
    const shouldShowBugs = !isAllowlisted;

    setShowBugsCta(shouldShowBugs);

    // Compute Bugs ticket link (even if excluded, we won't render it)
    let parsedDomain = "";
    try {
      const siteUri = new URL(contextData?.cf_site_uri || "");
      parsedDomain = siteUri.hostname;
    } catch {
      // ignore
    }

    // Obfuscate domain for safety, just include "[.]"
    const obfuscatedDomain = parsedDomain
      ? parsedDomain.replace(/\./g, "[.]")
      : "(unknown)";

    const summary = `Internal Gateway Block Categorisation: ${obfuscatedDomain}`;

    const descriptionLines = [
      "*Context information from Zero Security Corp Gateway block page:*",
      "",
      `*Domain*: ${parsedDomain || "(unknown)"}`,
      `*Rule ID*: ${contextData?.cf_rule_id || "(unknown)"}`,
      `*Filter*: ${contextData?.cf_filter || "(unknown)"}  (http|dns|av|l4)`,
      `*Account ID*: ${contextData?.cf_account_id || "(unknown)"}`,
      `*User Email*: ${contextData?.cf_user_email || "(unknown)"}`,
    ];
    const description = descriptionLines.join("\n");

    try {
      const u = new URL(bugsTicketUrlBase);

      u.searchParams.set("pid", "12345");          // BUGS project id
      u.searchParams.set("issuetype", "1");        // Bug ticket type 
      u.searchParams.set("priority", "45678");     // P4 Normal priority
      u.searchParams.set("summary", summary);
      u.searchParams.set("description", description);

      setBugsTicketHref(u.toString());
    } catch {
      setBugsTicketHref("");
    }
  }, [contextData, bugsPolicyIds, bugsTicketUrlBase, excludedPolicyIds]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-white flex flex-col items-center justify-center z-50">
        <MutatingDots
          height="150"
          width="150"
          color={primaryColor}
          secondaryColor={secondaryColor}
          radius="15"
          ariaLabel="mutating-dots-loading"
          visible={true}
        />
      </div>
    );
  }

  if (!contextData) {
    return (
      <div className="p-4 text-center">
        <h1 className="text-2xl font-bold mb-4">No Data Found</h1>
        <p>Unable to load redirect context.</p>
      </div>
    );
  }

  let domain = "";
  try {
    const siteUri = new URL(contextData.cf_site_uri || "");
    domain = siteUri.hostname;
  } catch (e) {
    console.warn("Invalid cf_site_uri:", contextData.cf_site_uri);
  }

  // Parse categories from context
  let requestCategories = [];
  try {
    const raw = contextData?.cf_request_category_names;
    if (Array.isArray(raw)) {
      requestCategories = raw.filter(Boolean);
    } else if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          requestCategories = parsed.filter(Boolean);
        } else {
          requestCategories = String(raw)
            .split(/[;,]/)
            .map((s) => s.trim())
            .filter(Boolean);
        }
      } catch {
        requestCategories = String(raw)
          .split(/[;,]/)
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }
  } catch {
  }

  const isExcluded = excludedPolicyIds.includes(contextData?.cf_rule_id);

  return (
    <div className="bg-steel min-h-screen relative">
      <div className={`max-w-7xl mx-auto ${isMobile ? "px-4" : "px-[100px]"} py-6 sm:py-10`}>
        <h1 className={`${isMobile ? "text-2xl" : "text-4xl"} font-bold mb-6 text-center`}>
          This site is blocked by the Zero Security Corp Security team
        </h1>
        <hr className="my-6 border-gray-light" />

        <div className="flex justify-center mb-6">
          <Alert type="info">
            <div className="text-center">
              Zero Security Corp Threat Intel has flagged this domain as a potential security risk.<br />
              <span className="italic">
                {ruleData?.result?.description ?? (ruleData ? "No description provided." : "")}
              </span>
            </div>
          </Alert>
        </div>

        {/* Security categories derived from cf_request_category_names field in context */}
        {requestCategories.length > 0 && bugsPolicyIds.includes(contextData?.cf_rule_id) && (
          <>
            <h2 className="text-center text-lg mb-2">Categories matched by Radar:</h2>
            <div className="flex flex-wrap justify-center gap-2 mb-6">
              {requestCategories.map((cat, idx) => (
                <span
                  key={`${cat}-${idx}`}
                  className="inline-flex items-center px-3 py-1 rounded text-sm bg-alertred text-black border border-red"
                >
                  {cat}
                </span>
              ))}
            </div>
          </>
        )}

        {/* Redirect Context json */}
        <div className="bg-white rounded shadow p-4 mb-6 relative">
          <h2 className={`${isMobile ? "text-xl" : "text-2xl"} font-bold mb-4`}>Redirect Context</h2>

          {/* Copy Icon Button */}
          <div className="absolute top-4 right-4">
            <button
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(contextData, null, 2));
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="text-gray-500 hover:text-black p-2 rounded-full transition duration-150 ease-in-out"
              aria-label="Copy JSON"
            >
              <i className="bx bx-copy text-xl"></i>
            </button>

            {/* Tooltip */}
            {copied && (
              <div className="absolute top-full right-0 mt-1 px-2 py-1 text-xs bg-white text-black rounded shadow z-10">
                Copied!
              </div>
            )}
          </div>

          {/* JSON Output from the GW context */}
          <pre className="bg-gray-100 p-4 rounded overflow-auto font-mono text-sm">
            {JSON.stringify(contextData, null, 2)}
          </pre>
        </div>

        {/* Gateway Rule Card */}
        {ruleError && (
          <div className="bg-red text-black p-4 rounded shadow mb-6">
            <strong>Error:</strong> {ruleError}
          </div>
        )}

        {debugEnabled && ruleData && (
          <div className="bg-white rounded shadow p-4 mb-6 relative">
            <h2 className="text-2xl font-bold mb-4">DEBUG: Gateway Rule Details</h2>
            
            {/* Copy Icon Button */}
            <div className="absolute top-4 right-4">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(ruleData, null, 2));
                  setCopiedRule(true);
                  setTimeout(() => setCopiedRule(false), 2000);
                }}
                className="text-gray-500 hover:text-black p-2 rounded-full transition duration-150 ease-in-out"
                aria-label="Copy JSON"
              >
                <i className="bx bx-copy text-xl"></i>
              </button>

              {/* Tooltip */}
              {copiedRule && (
                <div className="absolute top-full right-0 mt-1 px-2 py-1 text-xs bg-white text-black rounded shadow z-10">
                  Copied!
                </div>
              )}
            </div>

            <pre className="bg-gray-100 p-4 rounded overflow-auto">
              {JSON.stringify(ruleData, null, 2)}
            </pre>
          </div>
        )}

        {/* CTA section — completely omitted if excluded */}
        {domain && !isExcluded && (
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mt-6">
            {/* If policy ID IS in allowlist -> show Radar buttons; else -> show Bugs */}
            {!showBugsCta ? (
              <>
                <a
                  href={`https://radar.cloudflare.com/domains/domain/${domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="secondary" secondaryColor={secondaryColor}>
                    View in Radar
                  </Button>
                </a>
                <a
                  href={`https://radar.cloudflare.com/domains/feedback/${domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="secondary" secondaryColor={secondaryColor}>
                    Submit Recategorization Request
                  </Button>
                </a>
              </>
            ) : (
              bugsTicketHref && (
                <a href={bugsTicketHref} target="_blank" rel="noopener noreferrer">
                  <Button variant="secondary" secondaryColor={secondaryColor}>
                    Submit Bugs Ticket
                  </Button>
                </a>
              )
            )}
          </div>
        )}

        {domain && isExcluded && (
          <div className="mt-6 text-center text-sm text-gray-600">
            No actions are available for this block.
          </div>
        )}
      </div>
    </div>
  );
};

export default GatewayRedirect;