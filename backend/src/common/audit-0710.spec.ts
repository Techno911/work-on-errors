import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { isValidImageFile, isValidAudioFile } from './file-sniff.util';
import { AuthService } from '../auth/auth.service';
import { InviteStatus } from '../invites/entities/invite.entity';

// AUDIT-0710: замки на находки аудита 07.10.2026 — 500-as-413, снифф файлов,
// гейт регистрации по приглашению/оферте.

describe('HttpExceptionFilter — переполнение тела отдаёт 413, а не 500 (M4)', () => {
  function call(exception: unknown) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ headers: {}, method: 'POST', url: '/api/entries' }),
      }),
    } as any;
    new HttpExceptionFilter().catch(exception, host);
    return { status, json };
  }

  it('entity.too.large → 413 с понятным текстом', () => {
    const err = Object.assign(new Error('request entity too large'), { type: 'entity.too.large' });
    const { status, json } = call(err);
    expect(status).toHaveBeenCalledWith(413);
    expect(json.mock.calls[0][0].message).toContain('слишком большой');
  });

  it('обычное не-HttpException остаётся 500', () => {
    const { status } = call(new TypeError('boom'));
    expect(status).toHaveBeenCalledWith(500);
  });
});

describe('file-sniff — тип файла проверяется по содержимому (L3)', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniff-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const put = (name: string, buf: Buffer | string) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, buf);
    return p;
  };

  it('SVG под меткой image/png отклоняется', () => {
    const f = put('fake.png', '<svg onload=alert(1)></svg>');
    expect(isValidImageFile(f)).toBe(false);
  });
  it('настоящий PNG проходит', () => {
    const f = put('real.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
    expect(isValidImageFile(f)).toBe(true);
  });
  it('JPEG-сигнатура проходит, произвольный бинарь — нет', () => {
    expect(isValidImageFile(put('r.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])))).toBe(true);
    expect(isValidImageFile(put('x.bin', Buffer.from([0x00, 0x01, 0x02, 0x03])))).toBe(false);
  });
  it('аудио: OggS/RIFF-WAVE проходят, картинка — нет', () => {
    expect(isValidAudioFile(put('a.ogg', Buffer.from('OggSxxxxxxxx')))).toBe(true);
    expect(isValidAudioFile(put('a.wav', Buffer.from('RIFFxxxxWAVE')))).toBe(true);
    expect(isValidAudioFile(put('a.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])))).toBe(false);
  });
});

describe('AuthService.register — регистрация только по приглашению/оферте (H1)', () => {
  function build(opts: { openReg?: string; invite?: any; company?: any }) {
    const configService = { get: jest.fn((k: string) => (k === 'OPEN_REGISTRATION' ? opts.openReg : undefined)) };
    const usersService = {
      create: jest.fn().mockResolvedValue({ id: 'u1', email: 'x@example.invalid' }),
      markLogin: jest.fn().mockResolvedValue(undefined),
    };
    const inviteRepository = { findOne: jest.fn().mockResolvedValue(opts.invite ?? null) };
    const companyRepository = { findOne: jest.fn().mockResolvedValue(opts.company ?? null) };
    const service = new AuthService(
      usersService as any, {} as any, configService as any, {} as any,
      inviteRepository as any, companyRepository as any,
    );
    return { service, usersService };
  }
  const dto = { email: 'new@example.invalid', password: 'secret1', fullName: 'N' } as any;

  it('без inviteCode и offerToken → 403', async () => {
    const { service, usersService } = build({});
    await expect(service.register(dto)).rejects.toMatchObject({ status: 403 });
    expect(usersService.create).not.toHaveBeenCalled();
  });
  it('OPEN_REGISTRATION=false → 403 даже с приглашением', async () => {
    const invite = { status: InviteStatus.PENDING, email: 'new@example.invalid', expiresAt: null };
    const { service } = build({ openReg: 'false', invite });
    await expect(service.register({ ...dto, inviteCode: 'c' })).rejects.toMatchObject({ status: 403 });
  });
  it('живой inviteCode с тем же email → аккаунт создаётся', async () => {
    const invite = { status: InviteStatus.PENDING, email: 'new@example.invalid', expiresAt: null };
    const { service, usersService } = build({ invite });
    const jwtSpy = jest.spyOn(service as any, 'generateTokenPair').mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    jest.spyOn(service as any, 'saveRefreshToken').mockResolvedValue(undefined);
    const res = await service.register({ ...dto, inviteCode: 'code1' });
    expect(usersService.create).toHaveBeenCalled();
    expect(res.accessToken).toBe('a');
    jwtSpy.mockRestore();
  });
  it('inviteCode чужого email → 403', async () => {
    const invite = { status: InviteStatus.PENDING, email: 'other@example.invalid', expiresAt: null };
    const { service } = build({ invite });
    await expect(service.register({ ...dto, inviteCode: 'code1' })).rejects.toMatchObject({ status: 403 });
  });
  it('живой offerToken → аккаунт создаётся', async () => {
    const { service, usersService } = build({ company: { id: 'c1' } });
    jest.spyOn(service as any, 'generateTokenPair').mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    jest.spyOn(service as any, 'saveRefreshToken').mockResolvedValue(undefined);
    const res = await service.register({ ...dto, offerToken: 'tok' });
    expect(usersService.create).toHaveBeenCalled();
    expect(res.accessToken).toBe('a');
  });
});
