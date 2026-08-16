"use client";

import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";

export function ComingSoon({ title, note }: { title: string; note: string }) {
  return (
    <motion.div
      variants={staggerContainer(0.06)}
      initial="hidden"
      animate="show"
      className="space-y-5"
    >
      <motion.h1
        variants={staggerItem}
        className="text-2xl font-semibold tracking-tight"
      >
        {title}
      </motion.h1>
      <motion.div
        variants={staggerItem}
        className="glass rounded-2xl px-6 py-16 text-center"
      >
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{note}</p>
      </motion.div>
    </motion.div>
  );
}
