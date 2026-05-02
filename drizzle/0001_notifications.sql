CREATE TYPE "public"."notification_type" AS ENUM('info', 'success', 'warning', 'error');

CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "type" "notification_type" DEFAULT 'info' NOT NULL,
  "read" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
