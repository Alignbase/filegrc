import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "zod";

const faqSchema = z.object({
  question: z.string(),
  answer: z.string(),
});

const furtherReadingSchema = z.object({
  text: z.string(),
  url: z.string(),
});

const blogCollection = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedDate: z.coerce.date(),
    lastMod: z.coerce.date(),
    author: z.string(),
    authorXUrl: z.url().optional(),
    authorLinkedinUrl: z.url().optional(),
    tags: z.array(z.string()).min(1),
    featured: z.boolean().optional().default(false),
    image: z.url().optional(),
    imageCaption: z.string().optional(),
    faqs: z.array(faqSchema).min(3).max(8),
    furtherReading: z.array(furtherReadingSchema).optional(),
  }),
});

export const collections = {
  blog: blogCollection,
};
