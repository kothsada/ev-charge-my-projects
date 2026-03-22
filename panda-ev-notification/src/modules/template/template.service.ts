import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../configs/prisma/prisma.service';

@Injectable()
export class TemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async findBySlug(slug: string) {
    return this.prisma.notificationTemplate.findFirst({
      where: { slug, isActive: true },
    });
  }

  // Render title/body for given language with variable substitution
  render(
    template: {
      titleEn: string;
      titleLo: string;
      titleZh: string;
      bodyEn: string;
      bodyLo: string;
      bodyZh: string;
    },
    lang: string,
    vars: Record<string, unknown> = {},
  ) {
    const langKey = ['en', 'lo', 'zh'].includes(lang) ? lang : 'en';
    const titleKey =
      `title${langKey.charAt(0).toUpperCase() + langKey.slice(1)}` as keyof typeof template;
    const bodyKey =
      `body${langKey.charAt(0).toUpperCase() + langKey.slice(1)}` as keyof typeof template;

    const interpolate = (str: string) =>
      str.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));

    return {
      title: interpolate(template[titleKey] as string),
      body: interpolate(template[bodyKey] as string),
    };
  }
}
