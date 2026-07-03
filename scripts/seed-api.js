import axios from "axios";
import { CookieJar } from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const jar = new CookieJar();

const api = wrapper(
  axios.create({
    baseURL: BASE_URL,
    jar,
    withCredentials: true,
    headers: {
      "Content-Type": "application/json",
    },
  }),
);

async function safeRequest(label, requestFn) {
  try {
    const response = await requestFn();
    console.log(`✅ ${label}`);
    return response.data;
  } catch (error) {
    console.log(`❌ ${label}`);

    if (error.response) {
      console.log("Status:", error.response.status);
      console.log("Response:", error.response.data);
    } else {
      console.log(error.message);
    }

    throw error;
  }
}

// function that seeds only one row
async function seedOneSet(index) {
  const student = {
    name: `Student ${index}`,
    email: `student${index}@example.com`,
    password: "StrongPass123",
  };

  const studentRegister = await safeRequest(`Register student ${index}`, () =>
    api.post("/api/v1/auth/register", student),
  );

  const studentId = studentRegister?.data?.id;

  await safeRequest(`Update student profile ${index}`, () =>
    api.patch("/api/v1/users/profile", {
      name: student.name,
      phone: `07574512${String(index).padStart(2, "0")}`,
      address: `${index}, Colombo Road`,
      district: "Colombo",
      dateOfBirth: "2000-06-15T00:00:00.000Z",
      alStream: "Technology",
    }),
  );

  await api.post("/api/v1/auth/logout");

  await safeRequest("Login as admin", () =>
    api.post("/api/v1/auth/login", {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    }),
  );

  const bootcamp = await safeRequest(`Create bootcamp ${index}`, () =>
    api.post("/api/v1/bootcamps", {
      title: `Web Development Bootcamp ${index}`,
      slug: `web-development-bootcamp-${index}`,
      description: `Sample bootcamp ${index} for testing LMS data.`,
      price: 25000 + index * 1000,
      certificateEnabled: true,
      skills: ["HTML", "CSS", "JavaScript", "React"],
    }),
  );

  const bootcampId = bootcamp?.data?.id;

  await safeRequest(`Publish bootcamp ${index}`, () =>
    api.patch(`/api/v1/bootcamps/${bootcampId}/publish`),
  );

  const session = await safeRequest(`Create session ${index}`, () =>
    api.post(`/api/v1/bootcamps/${bootcampId}/sessions`, {
      title: `Session ${index} - Introduction`,
      description: `Introduction session for bootcamp ${index}.`,
      orderIndex: 0,
      recordingUrl: `https://example.com/recordings/session-${index}`,
      materialUrl: `https://example.com/materials/session-${index}.pdf`,
      quizUrl: `https://example.com/quizzes/session-${index}`,
      feedbackUrl: `https://example.com/forms/session-${index}`,
      durationMinutes: 90,
      isPublished: true,
    }),
  );

  const sessionId = session?.data?.id;

  const enrollment = await safeRequest(`Enroll student ${index}`, () =>
    api.post("/api/v1/enrollments", {
      userId: studentId,
      bootcampId,
      paymentStatus: "COMPLETED",
    }),
  );

  const enrollmentId = enrollment?.data?.id;

  await safeRequest(`Complete enrollment ${index}`, () =>
    api.patch(`/api/v1/enrollments/${enrollmentId}`, {
      status: "COMPLETED",
      paymentStatus: "COMPLETED",
      paymentCompletedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    }),
  );

  await safeRequest(`Issue certificate ${index}`, () =>
    api.post(`/api/v1/enrollments/${enrollmentId}/certificate`, {
      description: `Certificate for student ${index}.`,
      issuedDate: new Date().toISOString(),
    }),
  );

  await api.post("/api/v1/auth/logout");

  await safeRequest(`Login as student ${index}`, () =>
    api.post("/api/v1/auth/login", {
      email: student.email,
      password: student.password,
    }),
  );

  await safeRequest(`Mark session complete ${index}`, () =>
    api.post(`/api/v1/sessions/${sessionId}/complete`),
  );

  await safeRequest(`Submit project ${index}`, () =>
    api.post("/api/v1/projects", {
      bootcampId,
      enrollmentId,
      title: `Portfolio Project ${index}`,
      description: `Sample student project ${index}.`,
      thumbnailUrl: `https://example.com/images/project-${index}.png`,
      projectUrl: `https://project-${index}.example.com`,
      githubUrl: `https://github.com/example/project-${index}`,
      demoUrl: `https://project-${index}.example.com/demo`,
      technologies: ["HTML", "CSS", "JavaScript"],
      isPublic: true,
    }),
  );

  await api.post("/api/v1/auth/logout");
}

// the actual seeder
async function seed() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set for seed-api.");
  }
  console.log("🌱 Starting multiple API seed...");

  await safeRequest("Health check", () => api.get("/api/health"));

  const TOTAL_ROWS = 5;

  for (let i = 1; i <= TOTAL_ROWS; i++) {
    console.log(`\n========== Seeding dataset ${i} ==========\n`);
    await seedOneSet(i);
  }

  console.log("🎉 All seed data inserted successfully!");
}

seed();
