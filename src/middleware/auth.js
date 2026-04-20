import DescopeClient from "@descope/node-sdk";
import dotenv from "dotenv";

dotenv.config();

const descopeClient = DescopeClient({
  projectId: process.env.DESCOPE_PROJECT_ID,
  // Management key is only needed for management tasks, 
  // but good to have if we expand.
  managementKey: process.env.DESCOPE_MANAGEMENT_KEY 
});

export const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    // Validate session token
    const authInfo = await descopeClient.validateSession(token);
    
    // Descope returns session information including user ID (sub)
    // We attach it to the request object for use in routes
    req.user = {
      userId: authInfo.token.sub,
      ...authInfo.token
    };
    
    next();
  } catch (error) {
    console.error("Auth validation failed:", error);
    return res.status(401).json({ error: "Unauthorized" });
  }
};
