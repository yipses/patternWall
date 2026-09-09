import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { generators, getGenerator } from '@patternwall/core';
import { Editor } from '../../../components/Editor';

export function generateStaticParams() {
  return generators.map((g) => ({ id: g.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const g = getGenerator(id);
  if (!g) return { title: 'Pattern not found' };
  return {
    title: g.name,
    description: `${g.tagline} Tune ${g.name} against a curated palette, preview it on the iPhone Lock Screen, and export a wallpaper at device resolution.`,
  };
}

export default async function PatternPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getGenerator(id)) notFound();
  return <Editor generatorId={id} />;
}
