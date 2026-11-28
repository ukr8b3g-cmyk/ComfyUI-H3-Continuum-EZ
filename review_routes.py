"""Read-only status for Studio. Review operations execute in the Core queue."""
import asyncio
import sys

from .review_store import ReviewError, ReviewStore, token


def register_review_routes(server=None):
    if server is None:
        module = sys.modules.get('server')
        server = getattr(getattr(module, 'PromptServer', None), 'instance', None)
    if server is None or getattr(server, '_h3ez_review_routes_registered', False):
        return
    from aiohttp import web
    import folder_paths

    @server.routes.get('/h3-continuum-ez/review/{run}')
    async def review_status(request):
        try:
            run = ReviewStore(folder_paths.get_output_directory(), request.match_info['run'],
                              token(request.headers.get('X-H3EZ-Binding')))
            if not run.folder.exists() or not run.manifest.exists():
                return web.json_response({'state': None}, headers={'Cache-Control': 'no-store'})
            return web.json_response({'state': run.status()}, headers={'Cache-Control': 'no-store'})
        except ReviewError as error:
            return web.json_response({'error': str(error)}, status=409)
        except (OSError, ValueError, KeyError, TypeError):
            return web.json_response({'error': 'Review data could not be read'}, status=409)

    @server.routes.get('/h3-continuum-ez/review/{run}/join/{filename}')
    async def review_join(request):
        from .review_join import diagnose_join
        try:
            run = ReviewStore(folder_paths.get_output_directory(), request.match_info['run'],
                              token(request.headers.get('X-H3EZ-Binding')))
            result = await asyncio.to_thread(diagnose_join, run, request.match_info['filename'])
            return web.json_response(result, headers={'Cache-Control': 'no-store'})
        except (OSError, ValueError, KeyError, TypeError, IndexError):
            return web.json_response({'error': 'reviewDiagnosisUnavailable'}, status=409)

    server._h3ez_review_routes_registered = True
