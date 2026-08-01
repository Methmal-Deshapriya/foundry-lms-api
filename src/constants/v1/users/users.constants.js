/**
 * User Module Constants
 * Centralizes role names and other user-related fixed values.
 */

export const ROLES = {
  STUDENT: "STUDENT",
  ADMIN: "ADMIN",
  SUPER_ADMIN: "SUPER_ADMIN",
};

// List of all valid roles for validation loops if needed
export const ALL_ROLES = Object.values(ROLES);

// The 25 administrative districts of Sri Lanka
export const DISTRICTS = [
  "Colombo",
  "Gampaha",
  "Kalutara",
  "Kandy",
  "Matale",
  "Nuwara Eliya",
  "Galle",
  "Matara",
  "Hambantota",
  "Jaffna",
  "Kilinochchi",
  "Mannar",
  "Vavuniya",
  "Mullaitivu",
  "Batticaloa",
  "Ampara",
  "Trincomalee",
  "Kurunegala",
  "Puttalam",
  "Anuradhapura",
  "Polonnaruwa",
  "Badulla",
  "Monaragala",
  "Ratnapura",
  "Kegalle",
];

// Standard G.C.E. Advanced Level subject streams
export const AL_STREAMS = [
  "Science",
  "Mathematics",
  "Commerce",
  "Arts",
  "Technology",
];
