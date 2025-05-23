(function () {
	'use strict';

	var hostAddress = 'http://smotret24.ru/';

	if (!window.rch) {
		Lampa.Utils.putScript(["https://qlampa.github.io/plugins/invc-rch.js"], function () { }, false, function () {
			if (!window.rch.startTypeInvoke)
				window.rch.typeInvoke('http://smotret24.ru', function () { });
		}, true);
	}

	var hubConnection;
	var hubTimer;

	function rchInvoke(json, call) {
		if (hubConnection) {
			clearTimeout(hubTimer);
			hubConnection.stop();
			hubConnection = null;
		}

		hubConnection = new signalR.HubConnectionBuilder().withUrl(json.ws).build();
		hubConnection.start().then(function () {
			window.rch.Registry(json.result, hubConnection, function () {
				call();
			});
		})["catch"](function (err) {
			Lampa.Noty.show(err.toString());
			//return console.error(err.toString());
		});

		if (json.keepalive > 0) {
			hubTimer = setTimeout(function () {
				hubConnection.stop();
				hubConnection = null;
			}, 1000 * json.keepalive);
		}
	}

	function rchRun(json, call) {
		if (typeof signalR == 'undefined') {
			Lampa.Utils.putScript(["http://smotret24.ru/signalr-6.0.25_es5.js"], function () { }, false, function () {
				rchInvoke(json, call);
			}, true);
		} else
			rchInvoke(json, call);
	}

	function account(url) {
		function getIP(callback) {
			var xhr = new XMLHttpRequest();
			xhr.open('GET', 'https://api.ipify.org?format=json', true);
			xhr.onreadystatechange = function () {
				if (xhr.readyState === 4) {
					if (xhr.status === 200) {
						try {
							var data = JSON.parse(xhr.responseText);
							callback(null, data.ip);
						} catch (err) {
							callback('Ошибка парсинга JSON', null);
						}
					} else
						callback('Ошибка запроса: ' + xhr.status, null);
				}
			};
			xhr.onerror = function () {
				callback('Ошибка сети', null);
			};
			xhr.send();
		}

		url = url + '';

		if (url.indexOf('account_email=') == -1) {
			var email = Lampa.Storage.get('account_email');
			if (email)
				url = Lampa.Utils.addUrlComponent(url, 'account_email=' + encodeURIComponent(email));
		}

		if (url.indexOf('uid=') == -1) {
			var uid = Lampa.Storage.get('lampac_unic_id', '');
			if (!uid) {
				uid = Lampa.Utils.uid(8).toLowerCase();
				Lampa.Storage.set('lampac_unic_id', uid);
			}
			if (uid)
				url = Lampa.Utils.addUrlComponent(url, 'uid=' + encodeURIComponent(uid));
		}

		if (url.indexOf('token=') == -1) {
			var token = '';
			if (token != '')
				url = Lampa.Utils.addUrlComponent(url, 'token=');
		}

		if (Lampa.Storage.get('user_ip') == '' && !Lampa.Storage.get('user_ip')) {
			getIP(function (error, ip) {
				if (!error && ip) {
					Lampa.Storage.set("user_ip", ip);
				}
			});
		}

		if (Lampa.Storage.get('user_ip'))
			url = Lampa.Utils.addUrlComponent(url, 'user_ip=' + Lampa.Storage.get('user_ip'));

		return url;
	}

	function QWatchComponent(object) {
		var network = new Lampa.Reguest();
		var scroll = new Lampa.Scroll({
			mask: true,
			over: true
		});
		var files = new Lampa.Explorer(object);
		var filter = new Lampa.Filter(object);

		var sources = {};
		var last;
		var activeSourceUrl;
		var activeBalancer;
		var initialized;
		var balancer_timer;
		var images = [];
		var number_of_requests = 0;
		var number_of_requests_timer;
		var life_wait_times = 0;
		var life_wait_timer;

		var filter_sources = {};
		var filter_translate = {
			season: Lampa.Lang.translate('torrent_serial_season'),
			voice: Lampa.Lang.translate('torrent_parser_voice'),
			source: Lampa.Lang.translate('settings_rest_source')
		};
		var filter_find = {
			season: [],
			voice: []
		};

		var availableBalancers = ['kinotochka', 'kinopub', 'lumex', 'filmix', 'filmixtv', 'fxapi', 'redheadsound', 'animevost', 'animego', 'animedia', 'animebesst', 'anilibria', 'rezka', 'rhsprem', 'kodik', 'remux', 'animelib', 'kinoukr', 'rc/filmix', 'rc/fxapi', 'rc/rhs', 'vcdn', 'lumex', 'collaps', 'collaps-dash', 'hdvb', 'mirage', 'alloha'];

		function getBalancerName(entryJson) {
			return (entryJson.balanser || entryJson.name.split(' ')[0]).toLowerCase();
		}

		function clarificationSearchAdd(value) {
			var id = Lampa.Utils.hash(object.movie.number_of_seasons ? object.movie.original_name : object.movie.original_title);
			var all = Lampa.Storage.get('clarification_search', '{}');
			all[id] = value;
			Lampa.Storage.set('clarification_search', all);
		}

		function clarificationSearchDelete() {
			var id = Lampa.Utils.hash(object.movie.number_of_seasons ? object.movie.original_name : object.movie.original_title);
			var all = Lampa.Storage.get('clarification_search', '{}');
			delete all[id];
			Lampa.Storage.set('clarification_search', all);
		}

		function clarificationSearchGet() {
			var id = Lampa.Utils.hash(object.movie.number_of_seasons ? object.movie.original_name : object.movie.original_title);
			var all = Lampa.Storage.get('clarification_search', '{}');
			return all[id];
		}

		this.initialize = function () {
			var self = this;
			this.setLoading(true);

			filter.onSearch = function (value) {
				clarificationSearchAdd(value);

				Lampa.Activity.replace({
					search: value,
					clarification: true,
					similar: true
				});
			};
			filter.onBack = function () {
				self.start();
			};
			filter.render().find('.selector').on('hover:enter', function () {
				clearInterval(balancer_timer);
			});
			filter.render().find('.filter--search').appendTo(filter.render().find('.torrent-filter'));
			filter.onSelect = function (type, a, b) {
				if (type == 'filter') {
					if (a.reset) {
						clarificationSearchDelete();

						self.replaceChoice({
							season: 0,
							voice: 0,
							voice_url: '',
							voice_name: ''
						});
						setTimeout(function () {
							Lampa.Select.close();
							Lampa.Activity.replace({
								clarification: 0,
								similar: 0
							});
						}, 10);
					} else {
						var url = filter_find[a.stype][b.index].url;
						var choice = self.getChoice();
						if (a.stype == 'voice') {
							choice.voice_name = filter_find.voice[b.index].title;
							choice.voice_url = url;
						}
						choice[a.stype] = b.index;
						self.saveChoice(choice);
						self.reset();
						self.request(url);
						setTimeout(Lampa.Select.close, 10);
					}
				} else if (type == 'sort') {
					Lampa.Select.close();
					object.lampac_custom_select = a.source;
					self.changeBalancer(a.source);
				}
			};
			if (filter.addButtonBack)
				filter.addButtonBack();
			filter.render().find('.filter--sort span').text(Lampa.Lang.translate('qwatch_balancer'));
			scroll.body().addClass('torrent-list');

			files.appendFiles(scroll.render());
			files.appendHead(filter.render());
			scroll.minus(files.render().find('.explorer__files-head'));
			scroll.body().append(Lampa.Template.get('qwatch_page_content_loader'));

			Lampa.Controller.enable('content');
			this.setLoading(false);
			if (object.balancer) {
				files.render().find('.filter--search').remove();
				sources = {};
				sources[object.balancer] = { name: object.balancer };
				activeBalancer = object.balancer;
				filter_sources = [];

				return network["native"](account(object.url.replace('rjson=', 'nojson=')), this.parse.bind(this), function () {
					files.render().find('.torrent-filter').remove();
					self.showEmptyPage();
				}, false, {
					dataType: 'text'
				});
			}
			this.externalids().then(function () {
				return self.createSource();
			}).then(function (json) {
				if (!availableBalancers.find(function (balancer) {
					return activeBalancer.slice(0, balancer.length) == balancer;
				})) {
					filter.render().find('.filter--search').addClass('hide');
				}
				self.search();
			})["catch"](function (err) {
				self.showNoConnectPage(err);
			});
		};
		this.rch = function (json, noReset) {
			var self = this;
			rchRun(json, function () {
				if (!noReset)
					self.find();
				else
					noReset();
			});
		};
		this.externalids = function () {
			return new Promise(function (resolve, reject) {
				if (!object.movie.imdb_id || !object.movie.kinopoisk_id) {
					var query = [];
					query.push('id=' + object.movie.id);
					query.push('serial=' + (object.movie.name ? 1 : 0));

					if (object.movie.imdb_id)
						query.push('imdb_id=' + (object.movie.imdb_id || ''));
					if (object.movie.kinopoisk_id)
						query.push('kinopoisk_id=' + (object.movie.kinopoisk_id || ''));

					var url = hostAddress + 'externalids?' + query.join('&');
					network.timeout(10000);
					network.silent(account(url), function (externalIdJson) {
						for (var name in externalIdJson)
							object.movie[name] = externalIdJson[name];

						resolve();
					}, function () {
						resolve();
					});
				} else
					resolve();
			});
		};
		this.updateBalancer = function (balancerName) {
			var last_select_balancer = Lampa.Storage.cache('qwatch_last_balancer', 3000, {});
			last_select_balancer[object.movie.id] = balancerName;
			Lampa.Storage.set('qwatch_last_balancer', last_select_balancer);
		};
		this.changeBalancer = function (balancerName) {
			this.updateBalancer(balancerName);
			Lampa.Storage.set('qwatch_balancer', balancerName);
			var to = this.getChoice(balancerName);
			var from = this.getChoice();
			if (from.voice_name)
				to.voice_name = from.voice_name;
			this.saveChoice(to, balancerName);
			Lampa.Activity.replace();
		};
		this.requestParams = function (url) {
			var query = [];
			var card_source = object.movie.source || 'tmdb'; //Lampa.Storage.field('source')
			query.push('id=' + object.movie.id);
			if (object.movie.imdb_id) query.push('imdb_id=' + (object.movie.imdb_id || ''));
			if (object.movie.kinopoisk_id) query.push('kinopoisk_id=' + (object.movie.kinopoisk_id || ''));
			query.push('title=' + encodeURIComponent(object.clarification ? object.search : object.movie.title || object.movie.name));
			query.push('original_title=' + encodeURIComponent(object.movie.original_title || object.movie.original_name));
			query.push('serial=' + (object.movie.name ? 1 : 0));
			query.push('original_language=' + (object.movie.original_language || ''));
			query.push('year=' + ((object.movie.release_date || object.movie.first_air_date || '0000') + '').slice(0, 4));
			query.push('source=' + card_source);
			query.push('rchtype=' + (window.rch ? window.rch.type : ''));
			query.push('clarification=' + (object.clarification ? 1 : 0));
			query.push('similar=' + (object.similar ? true : false));
			if (Lampa.Storage.get('account_email', ''))
				query.push('cub_id=' + Lampa.Utils.hash(Lampa.Storage.get('account_email', '')));
			return url + (url.indexOf('?') >= 0 ? '&' : '?') + query.join('&');
		};
		this.getLastChoiceBalancer = function () {
			var last_select_balancer = Lampa.Storage.cache('qwatch_last_balancer', 3000, {});
			if (last_select_balancer[object.movie.id])
				return last_select_balancer[object.movie.id];
			else
				return Lampa.Storage.get('qwatch_balancer', filter_sources.length ? filter_sources[0] : '');
		};
		this.startSource = function (sourcesJson) {
			return new Promise(function (resolve, reject) {
				sourcesJson.forEach(function (entry) {
					var sourceName = getBalancerName(entry);
					sources[sourceName] = {
						url: entry.url,
						name: entry.name,
						show: typeof entry.show == 'undefined' ? true : entry.show
					};
				});

				filter_sources = Lampa.Arrays.getKeys(sources);
				if (filter_sources.length) {
					var last_select_balancer = Lampa.Storage.cache('qwatch_last_balancer', 3000, {});
					if (last_select_balancer[object.movie.id])
						activeBalancer = last_select_balancer[object.movie.id];
					else
						activeBalancer = Lampa.Storage.get('qwatch_balancer', filter_sources[0]);

					if (!sources[activeBalancer] || (!sources[activeBalancer].show && !object.lampac_custom_select))
						activeBalancer = filter_sources[0];

					activeSourceUrl = sources[activeBalancer].url;
					resolve(sourcesJson);
				} else {
					reject();
				}
			});
		};
		this.lifeSource = function () {
			var self = this;
			return new Promise(function (resolve, reject) {
				var url = self.requestParams(hostAddress + 'lifeevents?memkey=' + (self.memkey || ''));
				var red = false;
				var gou = function gou(targetJson, any) {
					if (targetJson.accsdb)
						return reject(targetJson);

					var last_balancer = self.getLastChoiceBalancer();
					if (!red) {
						var _filter = targetJson.online.filter(function (c) {
							return (any ? c.show : (c.show && c.name.toLowerCase() == last_balancer));
						});
						if (_filter.length) {
							red = true;
							resolve(targetJson.online.filter(function (c) {
								return c.show;
							}));
						} else if (any)
							reject();
					}
				};
				var fin = function fin(call) {
					network.timeout(3000);
					network.silent(account(url), function (lifeSourcesJson) {
						life_wait_times++;
						filter_sources = [];
						sources = {};
						lifeSourcesJson.online.forEach(function (entry) {
							var sourceName = getBalancerName(entry);
							sources[sourceName] = {
								url: entry.url,
								name: entry.name,
								show: typeof entry.show == 'undefined' ? true : entry.show
							};
						});
						filter_sources = Lampa.Arrays.getKeys(sources);
						filter.set('sort', filter_sources.map(function (e) {
							return {
								title: sources[e].name,
								source: e,
								selected: e == activeBalancer,
								ghost: !sources[e].show
							};
						}));
						filter.chosen('sort', [sources[activeBalancer] ? sources[activeBalancer].name : activeBalancer]);
						gou(lifeSourcesJson);
						var lastBalancer = self.getLastChoiceBalancer();
						if (life_wait_times > 15 || lifeSourcesJson.ready) {
							filter.render().find('.qwatch-balancer-loader').remove();
							gou(lifeSourcesJson, true);
						} else if (!red && sources[lastBalancer] && sources[lastBalancer].show) {
							gou(lifeSourcesJson, true);
							life_wait_timer = setTimeout(fin, 1000);
						} else
							life_wait_timer = setTimeout(fin, 1000);
					}, function () {
						life_wait_times++;
						if (life_wait_times > 15)
							reject();
						else
							life_wait_timer = setTimeout(fin, 1000);
					});
				};
				fin();
			});
		};
		this.createSource = function () {
			var self = this;
			return new Promise(function (resolve, reject) {
				var url = self.requestParams(hostAddress + 'lite/events?life=true');
				network.timeout(15000);
				network.silent(account(url), function (targetJson) {
					if (targetJson.accsdb)
						return reject(targetJson);

					if (targetJson.life) {
						self.memkey = targetJson.memkey;
						if (targetJson.title) {
							if (object.movie.name)
								object.movie.name = targetJson.title;
							if (object.movie.title)
								object.movie.title = targetJson.title;
						}
						filter.render().find('.filter--sort').append('<span class="qwatch-balancer-loader" style="width: 1.2em; height: 1.2em; margin-top: 0; background: url(./img/loader.svg) no-repeat 50% 50%; background-size: contain; margin-left: 0.5em"></span>');
						self.lifeSource().then(self.startSource).then(resolve)["catch"](reject);
					} else
						self.startSource(targetJson).then(resolve)["catch"](reject);
				}, reject);
			});
		};
		/**
		 * Подготовка
		 */
		this.create = function () {
			return this.render();
		};
		/**
		 * Начать поиск
		 */
		this.search = function () { //this.loading(true)
			this.filter({
				source: filter_sources
			}, this.getChoice());
			this.find();
		};
		this.find = function () {
			this.request(this.requestParams(activeSourceUrl));
		};
		this.request = function (url) {
			number_of_requests++;
			if (number_of_requests < 10) {
				network["native"](account(url), this.parse.bind(this), this.showNoAnswerPage.bind(this), false, {
					dataType: 'text'
				});
				clearTimeout(number_of_requests_timer);
				number_of_requests_timer = setTimeout(function () {
					number_of_requests = 0;
				}, 4000);
			} else
				this.showEmptyPage();
		};
		this.parseJsonData = function (jsonDataString, name) {
			try {
				var html = $('<div>' + jsonDataString + '</div>');
				var elems = [];
				html.find(name).each(function () {
					var item = $(this);
					var data = JSON.parse(item.attr('data-json'));
					var season = item.attr('s');
					var episode = item.attr('e');
					var text = item.text();
					if (!object.movie.name) {
						if (text.match(/\d+p/i)) {
							if (!data.quality) {
								data.quality = {};
								data.quality[text] = data.url;
							}
							text = object.movie.title;
						}
						if (text == 'По умолчанию') {
							text = object.movie.title;
						}
					}
					if (episode)
						data.episode = parseInt(episode);
					if (season)
						data.season = parseInt(season);
					if (text)
						data.text = text;
					data.active = item.hasClass('active');
					elems.push(data);
				});
				return elems;
			} catch (err) {
				return [];
			}
		};
		this.getFileUrl = function (file, call) {
			var self = this;

			if (Lampa.Storage.field('player') !== 'inner' && file.stream && Lampa.Platform.is('apple')) {
				var newfile = Lampa.Arrays.clone(file);
				newfile.method = 'play';
				newfile.url = file.stream;
				call(newfile, {});
			}
			else if (file.method == 'play')
				call(file, {});
			else {
				Lampa.Loading.start(function () {
					Lampa.Loading.stop();
					Lampa.Controller.toggle('content');
					network.clear();
				});
				network["native"](account(file.url), function (json) {
					if (json.rch) {
						self.rch(json, function () {
							Lampa.Loading.stop();

							self.getFileUrl(file, call);
						});
					}
					else {
						Lampa.Loading.stop();
						call(json, json);
					}
				}, function () {
					Lampa.Loading.stop();
					call(false, {});
				});
			}
		};
		this.toPlayElement = function (file) {
			var play = {
				title: file.title,
				url: file.url,
				quality: file.qualitys,
				timeline: file.timeline,
				subtitles: file.subtitles,
				callback: file.mark
			};
			return play;
		};
		this.orUrlReserve = function (data) {
			if (data.url && typeof data.url == 'string' && data.url.indexOf(" or ") !== -1) {
				var urls = data.url.split(" or ");
				data.url = urls[0];
				data.url_reserve = urls[1];
			}
		};
		this.setDefaultQuality = function (data) {
			if (Lampa.Arrays.getKeys(data.quality).length) {
				for (var q in data.quality) {
					if (parseInt(q) == Lampa.Storage.field('video_quality_default')) {
						data.url = data.quality[q];
						this.orUrlReserve(data);
					}
					if (data.quality[q].indexOf(" or ") !== -1)
						data.quality[q] = data.quality[q].split(" or ")[0];
				}
			}
		};
		this.display = function (videos) {
			var self = this;
			this.draw(videos, {
				onEnter: function onEnter(item, html) {
					self.getFileUrl(item, function (json, json_call) {
						if (json && json.url) {
							var playlist = [];
							var first = self.toPlayElement(item);
							first.url = json.url;
							first.headers = json_call.headers || json.headers;
							first.quality = json_call.quality || item.qualitys;
							first.hls_manifest_timeout = json_call.hls_manifest_timeout || json.hls_manifest_timeout;
							first.subtitles = json.subtitles;
							first.vast_url = json.vast_url;
							first.vast_msg = json.vast_msg;
							self.orUrlReserve(first);
							self.setDefaultQuality(first);
							if (item.season) {
								videos.forEach(function (elem) {
									var cell = self.toPlayElement(elem);
									if (elem == item)
										cell.url = json.url;
									else {
										if (elem.method == 'call') {
											if (Lampa.Storage.field('player') !== 'inner') {
												cell.url = elem.stream;
												delete cell.quality;
											} else {
												cell.url = function (call) {
													self.getFileUrl(elem, function (stream, stream_json) {
														if (stream.url) {
															cell.url = stream.url;
															cell.quality = stream_json.quality || elem.qualitys;
															cell.subtitles = stream.subtitles;
															self.orUrlReserve(cell);
															self.setDefaultQuality(cell);
															elem.mark();
														} else {
															cell.url = '';
															Lampa.Noty.show(Lampa.Lang.translate('qwatch_no_link'));
														}
														call();
													}, function () {
														cell.url = '';
														call();
													});
												};
											}
										} else
											cell.url = elem.url;
									}
									self.orUrlReserve(cell);
									self.setDefaultQuality(cell);
									playlist.push(cell);
								}); //Lampa.Player.playlist(playlist)
							} else
								playlist.push(first);

							if (playlist.length > 1)
								first.playlist = playlist;

							if (first.url) {
								var element = first;
								element.isonline = true;
								if (element.url && element.isonline) {
									// online.js
								}
								else if (element.url) {
									if (Platform.is('browser') && location.host.indexOf("127.0.0.1") !== -1) {
										Noty.show('Видео открыто в playerInner', { time: 3000 });
										$.get('http://rc.bwa.to/player-inner/' + element.url);
										return;
									}

									Player.play(element);
								}
								Lampa.Player.play(first);
								Lampa.Player.playlist(playlist);
								item.mark();
								self.updateBalancer(activeBalancer);
							} else
								Lampa.Noty.show(Lampa.Lang.translate('qwatch_no_link'));
						} else
							Lampa.Noty.show(Lampa.Lang.translate('qwatch_no_link'));
					}, true);
				},
				onContextMenu: function onContextMenu(item, html, data, call) {
					self.getFileUrl(item, function (stream) {
						call({
							file: stream.url,
							quality: item.qualitys
						});
					}, true);
				}
			});
			this.filter({
				season: filter_find.season.map(function (s) {
					return s.title;
				}),
				voice: filter_find.voice.map(function (b) {
					return b.title;
				})
			}, this.getChoice());
		};
		this.parse = function (jsonDataString) {
			var json = Lampa.Arrays.decodeJson(jsonDataString, {});
			if (Lampa.Arrays.isObject(jsonDataString) && jsonDataString.rch)
				json = jsonDataString;
			if (json.rch)
				return this.rch(json);
			try {
				var videoItems = this.parseJsonData(jsonDataString, '.videos__item');
				var videoButtons = this.parseJsonData(jsonDataString, '.videos__button');
				if (videoItems.length == 1 && videoItems[0].method == 'link' && !videoItems[0].similar) {
					filter_find.season = videoItems.map(function (s) {
						return {
							title: s.text,
							url: s.url
						};
					});
					this.replaceChoice({
						season: 0
					});
					this.request(videoItems[0].url);
				} else {
					this.activity.loader(false);

					var videos = videoItems.filter(function (videoItem) {
						return videoItem.method == 'play' || videoItem.method == 'call';
					});
					var videosSimilar = videoItems.filter(function (videoItem) {
						return videoItem.similar;
					});

					if (videos.length) {
						if (videoButtons.length) {
							filter_find.voice = videoButtons.map(function (b) {
								return {
									title: b.text,
									url: b.url
								};
							});
							var select_voice_url = this.getChoice(activeBalancer).voice_url;
							var select_voice_name = this.getChoice(activeBalancer).voice_name;
							var find_voice_url = videoButtons.find(function (v) {
								return v.url == select_voice_url;
							});
							var find_voice_name = videoButtons.find(function (v) {
								return v.text == select_voice_name;
							});
							var find_voice_active = videoButtons.find(function (v) {
								return v.active;
							}); ////console.log('b',buttons)
							////console.log('u',find_voice_url)
							////console.log('n',find_voice_name)
							////console.log('a',find_voice_active)
							if (find_voice_url && !find_voice_url.active) {
								//console.log('Lampac', 'go to voice', find_voice_url);
								this.replaceChoice({
									voice: videoButtons.indexOf(find_voice_url),
									voice_name: find_voice_url.text
								});
								this.request(find_voice_url.url);
							} else if (find_voice_name && !find_voice_name.active) {
								//console.log('Lampac', 'go to voice', find_voice_name);
								this.replaceChoice({
									voice: videoButtons.indexOf(find_voice_name),
									voice_name: find_voice_name.text
								});
								this.request(find_voice_name.url);
							} else {
								if (find_voice_active) {
									this.replaceChoice({
										voice: videoButtons.indexOf(find_voice_active),
										voice_name: find_voice_active.text
									});
								}
								this.display(videos);
							}
						} else {
							this.replaceChoice({
								voice: 0,
								voice_url: '',
								voice_name: ''
							});
							this.display(videos);
						}
					} else if (videoItems.length) {
						if (videosSimilar.length) {
							this.similars(videosSimilar);
							this.activity.loader(false);
						} else { //this.activity.loader(true)
							filter_find.season = videoItems.map(function (s) {
								return {
									title: s.text,
									url: s.url
								};
							});
							var select_season = this.getChoice(activeBalancer).season;
							var season = filter_find.season[select_season] || filter_find.season[0]; // @test: ||
							//if (!season) season = filter_find.season[0];
							this.request(season.url);
						}
					} else
						this.showNoAnswerPage(json);
				}
			} catch (err) {
				this.showNoAnswerPage(err);
			}
		};
		this.similars = function (json) {
			var self = this;
			scroll.clear();
			json.forEach(function (elem) {
				elem.title = elem.text;
				elem.info = '';

				var info = [];
				var year = ((elem.start_date || elem.year || object.movie.release_date || object.movie.first_air_date || '') + '').slice(0, 4);
				if (year)
					info.push(year);
				if (elem.details)
					info.push(elem.details);

				var name = elem.title || elem.text;
				elem.title = name;
				elem.time = elem.time || '';
				elem.info = info.join('<span class="qwatch-split">●</span>');
				var item = Lampa.Template.get('qwatch_page_folder', elem);
				if (elem.img) {
					var image = $('<img style="height: 7em; width: 7em; border-radius: 0.3em;"/>');
					item.find('.qwatch__folder').empty().append(image);

					if (elem.img !== undefined) {
						if (elem.img.charAt(0) === '/')
							elem.img = hostAddress + elem.img.substring(1);
						if (elem.img.indexOf('/proxyimg') !== -1)
							elem.img = account(elem.img);
					}

					Lampa.Utils.imgLoad(image, elem.img);
				}
				item.on('hover:enter', function () {
					self.reset();
					self.request(elem.url);
				}).on('hover:focus', function (event) {
					last = event.target;
					scroll.update($(event.target), true);
				});
				scroll.append(item);
			});
			this.filter({
				season: filter_find.season.map(function (s) {
					return s.title;
				}),
				voice: filter_find.voice.map(function (b) {
					return b.title;
				})
			}, this.getChoice());
			Lampa.Controller.enable('content');
		};
		this.getChoice = function (for_balancer) {
			var data = Lampa.Storage.cache('qwatch_choice_' + (for_balancer || activeBalancer), 3000, {});
			var save = data[object.movie.id] || {};
			Lampa.Arrays.extend(save, {
				season: 0,
				voice: 0,
				voice_name: '',
				voice_id: 0,
				episodes_view: {},
				movie_view: ''
			});
			return save;
		};
		this.saveChoice = function (choice, for_balancer) {
			var data = Lampa.Storage.cache('qwatch_choice_' + (for_balancer || activeBalancer), 3000, {});
			data[object.movie.id] = choice;
			Lampa.Storage.set('qwatch_choice_' + (for_balancer || activeBalancer), data);
			this.updateBalancer(for_balancer || activeBalancer);
		};
		this.replaceChoice = function (choice, for_balancer) {
			var to = this.getChoice(for_balancer);
			Lampa.Arrays.extend(to, choice, true);
			this.saveChoice(to, for_balancer);
		};
		this.clearImages = function () {
			images.forEach(function (img) {
				img.onerror = function () { };
				img.onload = function () { };
				img.src = '';
			});
			images = [];
		};
		/**
		 * Очистить список файлов
		 */
		this.reset = function () {
			last = false;
			clearInterval(balancer_timer);
			network.clear();
			this.clearImages();
			scroll.render().find('.empty').remove();
			scroll.clear();
			scroll.reset();
			scroll.body().append(Lampa.Template.get('qwatch_page_content_loader'));
		};
		/**
		 * Загрузка
		 */
		this.setLoading = function (status) {
			if (status) this.activity.loader(true);
			else {
				this.activity.loader(false);
				this.activity.toggle();
			}
		};
		/**
		 * Построить фильтр
		 */
		this.filter = function (filter_items, choice) {
			var self = this;
			var select = [];
			var add = function add(type, title) {
				var need = self.getChoice();
				var items = filter_items[type];
				var subitems = [];
				var value = need[type];
				items.forEach(function (name, i) {
					subitems.push({
						title: name,
						selected: value == i,
						index: i
					});
				});
				select.push({
					title: title,
					subtitle: items[value],
					items: subitems,
					stype: type
				});
			};
			filter_items.source = filter_sources;
			select.push({
				title: Lampa.Lang.translate('torrent_parser_reset'),
				reset: true
			});
			this.saveChoice(choice);
			if (filter_items.voice && filter_items.voice.length)
				add('voice', Lampa.Lang.translate('torrent_parser_voice'));
			if (filter_items.season && filter_items.season.length)
				add('season', Lampa.Lang.translate('torrent_serial_season'));
			filter.set('filter', select);
			filter.set('sort', filter_sources.map(function (e) {
				return {
					title: sources[e].name,
					source: e,
					selected: e == activeBalancer,
					ghost: !sources[e].show
				};
			}));
			this.selected(filter_items);
		};
		/**
		 * Показать что выбрано в фильтре
		 */
		this.selected = function (filter_items) {
			var need = this.getChoice(), select = [];
			for (var i in need) {
				if (filter_items[i] && filter_items[i].length) {
					if (i == 'voice')
						select.push(filter_translate[i] + ': ' + filter_items[i][need[i]]);
					else if (i !== 'source' && filter_items.season.length >= 1)
						select.push(filter_translate.season + ': ' + filter_items[i][need[i]]);
				}
			}
			filter.chosen('filter', select);
			filter.chosen('sort', [sources[activeBalancer].name]);
		};
		this.getEpisodes = function (season, call) {
			var episodes = [];
			if (['cub', 'tmdb'].indexOf(object.movie.source || 'tmdb') == -1)
				return call(episodes);

			if (typeof object.movie.id == 'number' && object.movie.name) {
				var tmdburl = 'tv/' + object.movie.id + '/season/' + season + '?api_key=' + Lampa.TMDB.key() + '&language=' + Lampa.Storage.get('language', 'ru');
				var baseurl = Lampa.TMDB.api(tmdburl);
				network.timeout(1000 * 10);
				network["native"](baseurl, function (data) {
					episodes = data.episodes || [];
					call(episodes);
				}, function (a, c) {
					call(episodes);
				});
			} else
				call(episodes);
		};
		this.watched = function (set) {
			var file_id = Lampa.Utils.hash(object.movie.number_of_seasons ? object.movie.original_name : object.movie.original_title);
			var watched = Lampa.Storage.cache('qwatch_watched_last', 5000, {});
			if (set) {
				if (!watched[file_id])
					watched[file_id] = {};
				Lampa.Arrays.extend(watched[file_id], set, true);
				Lampa.Storage.set('qwatch_watched_last', watched);
				this.updateWatched();
			} else
				return watched[file_id];
		};
		this.updateWatched = function () {
			var watched = this.watched();
			var body = scroll.body().find('.qwatch-watched .qwatch-watched__body').empty();
			if (watched) {
				var line = [];
				if (watched.balancer_name)
					line.push(watched.balancer_name);
				if (watched.voice_name)
					line.push(watched.voice_name);
				if (watched.season)
					line.push(Lampa.Lang.translate('torrent_serial_season') + ' ' + watched.season);
				if (watched.episode)
					line.push(Lampa.Lang.translate('torrent_serial_episode') + ' ' + watched.episode);

				line.forEach(function (n) {
					body.append('<span>' + n + '</span>');
				});
			} else
				body.append('<span>' + Lampa.Lang.translate('qwatch_no_watch_history') + '</span>');
		};
		/**
		 * Отрисовка файлов
		 */
		this.draw = function (items) {
			var self = this;
			var params = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
			if (!items.length)
				return this.showEmptyPage();

			scroll.clear();
			if (!object.balancer)
				scroll.append(Lampa.Template.get('qwatch_page_watched', {}));

			this.updateWatched();
			this.getEpisodes(items[0].season, function (episodes) {
				var viewed = Lampa.Storage.cache('qwatch_view', 5000, []);
				var serial = object.movie.name ? true : false;
				var choice = self.getChoice();
				var fully = window.innerWidth > 480;
				var scroll_to_element = false;
				var scroll_to_mark = false;
				items.forEach(function (element, index) {
					var episode = serial && episodes.length && !params.similars ? episodes.find(function (e) {
						return e.episode_number == element.episode;
					}) : false;
					var episode_num = element.episode || index + 1;
					var episode_last = choice.episodes_view[element.season];
					var voice_name = choice.voice_name || (filter_find.voice[0] ? filter_find.voice[0].title : false) || element.voice_name || (serial ? 'Неизвестно' : element.text) || 'Неизвестно';
					if (element.quality) {
						element.qualitys = element.quality;
						element.quality = Lampa.Arrays.getKeys(element.quality)[0];
					}

					Lampa.Arrays.extend(element, {
						voice_name: voice_name,
						info: voice_name.length > 60 ? voice_name.substr(0, 60) + '...' : voice_name,
						quality: '',
						time: Lampa.Utils.secondsToTime((episode ? episode.runtime : object.movie.runtime) * 60, true)
					});
					var hash_timeline = Lampa.Utils.hash(element.season ? [element.season, element.season > 10 ? ':' : '', element.episode, object.movie.original_title].join('') : object.movie.original_title);
					var hash_behold = Lampa.Utils.hash(element.season ? [element.season, element.season > 10 ? ':' : '', element.episode, object.movie.original_title, element.voice_name].join('') : object.movie.original_title + element.voice_name);
					var data = {
						hash_timeline: hash_timeline,
						hash_behold: hash_behold
					};

					var info = [];
					if (element.season) {
						element.translate_episode_end = self.getLastEpisode(items);
						element.translate_voice = element.voice_name;
					}
					if (element.text && !episode)
						element.title = element.text;
					element.timeline = Lampa.Timeline.view(hash_timeline);

					if (episode) {
						element.title = episode.name;
						if (element.info.length < 30 && episode.vote_average) info.push(Lampa.Template.get('qwatch_entry_rating', {
							rate: parseFloat(episode.vote_average + '').toFixed(1)
						}, true));
						if (episode.air_date && fully) info.push(Lampa.Utils.parseTime(episode.air_date).full);
					} else if (object.movie.release_date && fully) {
						info.push(Lampa.Utils.parseTime(object.movie.release_date).full);
					}
					if (!serial && object.movie.tagline && element.info.length < 30)
						info.push(object.movie.tagline);
					if (element.info)
						info.push(element.info);
					if (info.length)
						element.info = info.map(function (i) {
							return '<span>' + i + '</span>';
						}).join('<span class="qwatch-split">●</span>');

					var html = Lampa.Template.get('qwatch_page_full', element);
					var loader = html.find('.qwatch__loader');
					var image = html.find('.qwatch__img');
					if (object.balancer)
						image.hide();

					if (!serial) {
						if (choice.movie_view == hash_behold)
							scroll_to_element = html;
					} else if (typeof episode_last !== 'undefined' && episode_last == episode_num)
						scroll_to_element = html;

					if (serial && !episode) {
						image.append('<div class="qwatch__episode-number">' + ('0' + (element.episode || index + 1)).slice(-2) + '</div>');
						loader.remove();
					} else if (!serial && ['cub', 'tmdb'].indexOf(object.movie.source || 'tmdb') == -1)
						loader.remove();
					else {
						var img = html.find('img')[0];
						img.onerror = function () {
							img.src = './img/img_broken.svg';
						};
						img.onload = function () {
							image.addClass('qwatch__img--loaded');
							loader.remove();
							if (serial) image.append('<div class="qwatch__episode-number">' + ('0' + (element.episode || index + 1)).slice(-2) + '</div>');
						};
						img.src = Lampa.TMDB.image('t/p/w300' + (episode ? episode.still_path : object.movie.backdrop_path));
						images.push(img);
					}

					html.find('.qwatch__timeline').append(Lampa.Timeline.render(element.timeline));
					if (viewed.indexOf(hash_behold) !== -1) {
						scroll_to_mark = html;
						html.find('.qwatch__img').append('<div class="qwatch__viewed">' + Lampa.Template.get('icon_viewed', {}, true) + '</div>');
					}

					element.mark = function () {
						viewed = Lampa.Storage.cache('qwatch_view', 5000, []);
						if (viewed.indexOf(hash_behold) == -1) {
							viewed.push(hash_behold);
							Lampa.Storage.set('qwatch_view', viewed);
							if (html.find('.qwatch__viewed').length == 0)
								html.find('.qwatch__img').append('<div class="qwatch__viewed">' + Lampa.Template.get('icon_viewed', {}, true) + '</div>');
						}

						choice = self.getChoice();
						if (!serial)
							choice.movie_view = hash_behold;
						else
							choice.episodes_view[element.season] = episode_num;
						self.saveChoice(choice);

						var voice_name_text = choice.voice_name || element.voice_name || element.title;
						if (voice_name_text.length > 30)
							voice_name_text = voice_name_text.slice(0, 30) + '...';

						self.watched({
							balancer: activeBalancer,
							balancer_name: Lampa.Utils.capitalizeFirstLetter(sources[activeBalancer] ? sources[activeBalancer].name.split(' ')[0] : activeBalancer),
							voice_id: choice.voice_id,
							voice_name: voice_name_text,
							episode: element.episode,
							season: element.season
						});
					};
					element.unmark = function () {
						viewed = Lampa.Storage.cache('qwatch_view', 5000, []);
						if (viewed.indexOf(hash_behold) !== -1) {
							Lampa.Arrays.remove(viewed, hash_behold);
							Lampa.Storage.set('qwatch_view', viewed);
							Lampa.Storage.remove('qwatch_view', hash_behold);
							html.find('.qwatch__viewed').remove();
						}
					};
					element.timeclear = function () {
						element.timeline.percent = 0;
						element.timeline.time = 0;
						element.timeline.duration = 0;
						Lampa.Timeline.update(element.timeline);
					};
					html.on('hover:enter', function () {
						if (object.movie.id) Lampa.Favorite.add('history', object.movie, 100);
						if (params.onEnter) params.onEnter(element, html, data);
					}).on('hover:focus', function (e) {
						last = e.target;
						if (params.onFocus) params.onFocus(element, html, data);
						scroll.update($(e.target), true);
					});
					if (params.onRender)
						params.onRender(element, html, data);

					self.contextMenu({
						html: html,
						element: element,
						onFile: function onFile(call) {
							if (params.onContextMenu) params.onContextMenu(element, html, data, call);
						},
						onClearAllMark: function onClearAllMark() {
							items.forEach(function (elem) {
								elem.unmark();
							});
						},
						onClearAllTime: function onClearAllTime() {
							items.forEach(function (elem) {
								elem.timeclear();
							});
						}
					});
					scroll.append(html);
				});

				if (serial && episodes.length > items.length && !params.similars) {
					var left = episodes.slice(items.length);
					left.forEach(function (episode) {
						var info = [];
						if (episode.vote_average)
							info.push(Lampa.Template.get('qwatch_entry_rating', {
								rate: parseFloat(episode.vote_average + '').toFixed(1)
							}, true));
						if (episode.air_date)
							info.push(Lampa.Utils.parseTime(episode.air_date).full);

						var airDate = new Date((episode.air_date + '').replace(/-/g, '/'));
						var daysLeft = Math.round((airDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
						var daysLeftText = Lampa.Lang.translate('full_episode_days_left') + ': ' + daysLeft;
						var html = Lampa.Template.get('qwatch_page_full', {
							time: Lampa.Utils.secondsToTime((episode ? episode.runtime : object.movie.runtime) * 60, true),
							info: info.length ? info.map(function (i) {
								return '<span>' + i + '</span>';
							}).join('<span class="qwatch-split">●</span>') : '',
							title: episode.name,
							quality: daysLeft > 0 ? daysLeftText : ''
						});

						var loader = html.find('.qwatch__loader');
						var image = html.find('.qwatch__img');
						var season = items[0] ? items[0].season : 1;
						html.find('.qwatch__timeline').append(Lampa.Timeline.render(Lampa.Timeline.view(Lampa.Utils.hash([season, episode.episode_number, object.movie.original_title].join('')))));
						var img = html.find('img')[0];
						if (episode.still_path) {
							img.onerror = function () {
								img.src = './img/img_broken.svg';
							};
							img.onload = function () {
								image.addClass('qwatch__img--loaded');
								loader.remove();
								image.append('<div class="qwatch__episode-number">' + ('0' + episode.episode_number).slice(-2) + '</div>');
							};
							img.src = Lampa.TMDB.image('t/p/w300' + episode.still_path);
							images.push(img);
						} else {
							loader.remove();
							image.append('<div class="qwatch__episode-number">' + ('0' + episode.episode_number).slice(-2) + '</div>');
						}

						html.on('hover:focus', function (event) {
							last = event.target;
							scroll.update($(event.target), true);
						});
						html.css('opacity', '0.5');
						scroll.append(html);
					});
				}

				if (scroll_to_element)
					last = scroll_to_element[0];
				else if (scroll_to_mark)
					last = scroll_to_mark[0];

				Lampa.Controller.enable('content');
			});
		};
		/**
		 * Меню
		 */
		this.contextMenu = function (params) {
			params.html.on('hover:long', function () {
				function show(extra) {
					var enabled = Lampa.Controller.enabled().name;
					var menu = [];
					if (Lampa.Platform.is('webos')) {
						menu.push({
							title: Lampa.Lang.translate('player_lauch') + ' - WebOS',
							player: 'webos'
						});
					}
					if (Lampa.Platform.is('android')) {
						menu.push({
							title: Lampa.Lang.translate('player_lauch') + ' - Android',
							player: 'android'
						});
					}
					menu.push({
						title: Lampa.Lang.translate('player_lauch') + ' - Lampa',
						player: 'lampa'
					});
					menu.push({
						title: Lampa.Lang.translate('qwatch_video'),
						separator: true
					});
					menu.push({
						title: Lampa.Lang.translate('torrent_parser_label_title'),
						mark: true
					});
					menu.push({
						title: Lampa.Lang.translate('torrent_parser_label_cancel_title'),
						unmark: true
					});
					menu.push({
						title: Lampa.Lang.translate('time_reset'),
						timeclear: true
					});
					if (extra) {
						menu.push({
							title: Lampa.Lang.translate('copy_link'),
							copylink: true
						});
					}
					if (window.qwatch_online_context_menu)
						window.qwatch_online_context_menu.push(menu, extra, params);
					menu.push({
						title: Lampa.Lang.translate('more'),
						separator: true
					});
					if (Lampa.Account.logged() && params.element && typeof params.element.season !== 'undefined' && params.element.translate_voice) {
						menu.push({
							title: Lampa.Lang.translate('qwatch_voice_subscribe'),
							subscribe: true
						});
					}
					menu.push({
						title: Lampa.Lang.translate('qwatch_clear_all_marks'),
						clearallmark: true
					});
					menu.push({
						title: Lampa.Lang.translate('qwatch_clear_all_timecodes'),
						timeclearall: true
					});

					Lampa.Select.show({
						title: Lampa.Lang.translate('title_action'),
						items: menu,
						onBack: function onBack() {
							Lampa.Controller.toggle(enabled);
						},
						onSelect: function onSelect(a) {
							if (a.mark) params.element.mark();
							if (a.unmark) params.element.unmark();
							if (a.timeclear) params.element.timeclear();
							if (a.clearallmark) params.onClearAllMark();
							if (a.timeclearall) params.onClearAllTime();
							if (window.qwatch_online_context_menu)
								window.qwatch_online_context_menu.onSelect(a, params);

							Lampa.Controller.toggle(enabled);

							if (a.player) {
								Lampa.Player.runas(a.player);
								params.html.trigger('hover:enter');
							}

							if (a.copylink) {
								if (extra.quality) {
									var qual = [];
									for (var i in extra.quality) {
										qual.push({
											title: i,
											file: extra.quality[i]
										});
									}
									Lampa.Select.show({
										title: Lampa.Lang.translate('settings_server_links'),
										items: qual,
										onBack: function onBack() {
											Lampa.Controller.toggle(enabled);
										},
										onSelect: function onSelect(b) {
											Lampa.Utils.copyTextToClipboard(b.file, function () {
												Lampa.Noty.show(Lampa.Lang.translate('copy_secuses'));
											}, function () {
												Lampa.Noty.show(Lampa.Lang.translate('copy_error'));
											});
										}
									});
								} else {
									Lampa.Utils.copyTextToClipboard(extra.file, function () {
										Lampa.Noty.show(Lampa.Lang.translate('copy_secuses'));
									}, function () {
										Lampa.Noty.show(Lampa.Lang.translate('copy_error'));
									});
								}
							}

							if (a.subscribe) {
								Lampa.Account.subscribeToTranslation({
									card: object.movie,
									season: params.element.season,
									episode: params.element.translate_episode_end,
									voice: params.element.translate_voice
								}, function () {
									Lampa.Noty.show(Lampa.Lang.translate('qwatch_voice_success'));
								}, function () {
									Lampa.Noty.show(Lampa.Lang.translate('qwatch_voice_error'));
								});
							}
						}
					});
				}
				params.onFile(show);
			}).on('hover:focus', function () {
				if (Lampa.Helper)
					Lampa.Helper.show('qwatch_file', Lampa.Lang.translate('helper_torrents'), params.html);
			});
		};
		this.showEmptyPage = function () {
			var html = Lampa.Template.get('qwatch_page_no_answer', {});
			html.find('.qwatch-empty__buttons').remove();
			html.find('.qwatch-empty__title').text(Lampa.Lang.translate('empty_title_two'));
			html.find('.qwatch-empty__time').text(Lampa.Lang.translate('empty_text'));
			scroll.clear();
			scroll.append(html);
			this.setLoading(false);
		};
		this.showNoConnectPage = function (err) {
			var html = Lampa.Template.get('qwatch_page_no_answer', {});
			html.find('.qwatch-empty__buttons').remove();
			html.find('.qwatch-empty__title').text(Lampa.Lang.translate('title_error'));
			html.find('.qwatch-empty__time').text(err && err.accsdb ? err.msg : Lampa.Lang.translate('qwatch_balancer_no_results').replace('{balancer}', sources[activeBalancer].name));
			scroll.clear();
			scroll.append(html);
			this.setLoading(false);
		};
		this.showNoAnswerPage = function (err) {
			var self = this;
			this.reset();
			var html = Lampa.Template.get('qwatch_page_no_answer', {
				balancer: activeBalancer
			});
			if (err && err.accsdb)
				html.find('.qwatch-empty__title').html(err.msg);

			var tic = err && err.accsdb ? 10 : 5;
			html.find('.cancel').on('hover:enter', function () {
				clearInterval(balancer_timer);
			});
			html.find('.change').on('hover:enter', function () {
				clearInterval(balancer_timer);
				filter.render().find('.filter--sort').trigger('hover:enter');
			});
			scroll.clear();
			scroll.append(html);
			this.setLoading(false);
			balancer_timer = setInterval(function () {
				tic--;
				html.find('.timeout').text(tic);
				if (tic == 0) {
					clearInterval(balancer_timer);
					var keys = Lampa.Arrays.getKeys(sources);
					var next = keys[keys.indexOf(activeBalancer) + 1];
					if (!next)
						next = keys[0];
					activeBalancer = next;
					if (Lampa.Activity.active().activity == self.activity)
						self.changeBalancer(activeBalancer);
				}
			}, 1000);
		};
		this.getLastEpisode = function (items) {
			var last_episode = 0;
			items.forEach(function (e) {
				if (typeof e.episode !== 'undefined')
					last_episode = Math.max(last_episode, parseInt(e.episode));
			});
			return last_episode;
		};
		/**
		 * Начать навигацию по файлам
		 */
		this.start = function () {
			if (Lampa.Activity.active().activity !== this.activity)
				return;

			if (!initialized) {
				initialized = true;
				this.initialize();
			}

			Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(object.movie));
			Lampa.Controller.add('content', {
				toggle: function toggle() {
					Lampa.Controller.collectionSet(scroll.render(), files.render());
					Lampa.Controller.collectionFocus(last || false, scroll.render());
				},
				gone: function gone() {
					clearTimeout(balancer_timer);
				},
				up: function up() {
					if (Navigator.canmove('up')) {
						Navigator.move('up');
					} else Lampa.Controller.toggle('head');
				},
				down: function down() {
					Navigator.move('down');
				},
				right: function right() {
					if (Navigator.canmove('right')) Navigator.move('right');
					else filter.show(Lampa.Lang.translate('title_filter'), 'filter');
				},
				left: function left() {
					if (Navigator.canmove('left')) Navigator.move('left');
					else Lampa.Controller.toggle('menu');
				},
				back: this.back.bind(this)
			});
			Lampa.Controller.toggle('content');
		};
		this.render = function () {
			return files.render();
		};
		this.back = function () {
			Lampa.Activity.backward();
		};
		this.pause = function () { };
		this.stop = function () { };
		this.destroy = function () {
			network.clear();
			this.clearImages();
			files.destroy();
			scroll.destroy();
			clearInterval(balancer_timer);
			clearTimeout(life_wait_timer);
			if (hubConnection) {
				clearTimeout(hubTimer);
				hubConnection.stop();
				hubConnection = null;
			}
		};
	}

	function addSourceSearch(spiderName, spiderUri) {
		var network = new Lampa.Reguest();

		var source = {
			title: spiderName,
			search: function (params, oncomplite) {
				function searchComplite(links) {
					var keys = Lampa.Arrays.getKeys(links);

					if (keys.length) {
						var status = new Lampa.Status(keys.length);

						status.onComplite = function (result) {
							var rows = [];

							keys.forEach(function (name) {
								var line = result[name];

								if (line && line.data && line.type == 'similar') {
									var cards = line.data.map(function (item) {
										item.title = Lampa.Utils.capitalizeFirstLetter(item.title);
										item.release_date = item.year || '0000';
										item.balancer = spiderUri;
										if (item.img !== undefined) {
											if (item.img.charAt(0) === '/')
												item.img = hostAddress + item.img.substring(1);
											if (item.img.indexOf('/proxyimg') !== -1)
												item.img = account(item.img);
										}

										return item;
									})

									rows.push({
										title: name,
										results: cards
									})
								}
							})

							oncomplite(rows);
						}

						keys.forEach(function (name) {
							network.silent(account(links[name]), function (data) {
								status.append(name, data);
							}, function () {
								status.error();
							})
						})
					} else {
						oncomplite([]);
					}
				}

				network.silent(account(hostAddress + 'lite/' + spiderUri + '?title=' + params.query), function (json) {
					if (json.rch) {
						rchRun(json, function () {
							network.silent(account(hostAddress + 'lite/' + spiderUri + '?title=' + params.query), function (links) {
								searchComplite(links);
							}, function () {
								oncomplite([]);
							});
						});
					} else {
						searchComplite(json);
					}
				}, function () {
					oncomplite([]);
				});
			},
			onCancel: function () {
				network.clear()
			},
			params: {
				lazy: true,
				align_left: true,
				card_events: {
					onMenu: function () { }
				}
			},
			onMore: function (params, close) {
				close();
			},
			onSelect: function (params, close) {
				close();

				Lampa.Activity.push({
					url: params.element.url,
					title: 'QWatch - ' + params.element.title,
					component: 'qwatch',
					movie: params.element,
					page: 1,
					search: params.element.title,
					clarification: true,
					balancer: params.element.balancer,
					noinfo: true
				});
			}
		}

		Lampa.Search.addSource(source)
	}

	function startPlugin() {
		window.plugin_qwatch_ready = true;

		var manifest = {
			type: 'video',
			version: '1.0.0',
			name: 'QWatch',
			description: 'Плагин для онлайн просмотра фильмов и сериалов',
			component: 'qwatch'
		};
		Lampa.Manifest.plugins = manifest;

		Lampa.Lang.add({
			qwatch_title: {
				ru: 'Онлайн',
				uk: 'Онлайн',
				en: 'Online',
				zh: '在线的'
			},
			qwatch_video: {
				ru: 'Видео',
				en: 'Video',
				uk: 'Відео',
				zh: '视频'
			},
			qwatch_no_watch_history: {
				ru: 'Нет истории просмотра',
				en: 'No browsing history',
				ua: 'Немає історії перегляду',
				zh: '没有浏览历史'
			},
			qwatch_no_link: {
				ru: 'Не удалось извлечь ссылку',
				uk: 'Неможливо отримати посилання',
				en: 'Failed to fetch link',
				zh: '获取链接失败'
			},
			qwatch_balancer: {
				ru: 'Источник',
				uk: 'Джерело',
				en: 'Source',
				zh: '来源'
			},
			qwatch_voice_subscribe: {
				ru: 'Подписаться на перевод',
				uk: 'Підписатися на переклад',
				en: 'Subscribe to translation',
				zh: '订阅翻译'
			},
			qwatch_voice_success: {
				ru: 'Вы успешно подписались',
				uk: 'Ви успішно підписалися',
				en: 'You have successfully subscribed',
				zh: '您已成功订阅'
			},
			qwatch_voice_error: {
				ru: 'Возникла ошибка',
				uk: 'Виникла помилка',
				en: 'An error has occurred',
				zh: '发生了错误'
			},
			qwatch_clear_all_marks: {
				ru: 'Очистить все метки',
				uk: 'Очистити всі мітки',
				en: 'Clear all labels',
				zh: '清除所有标签'
			},
			qwatch_clear_all_timecodes: {
				ru: 'Очистить все тайм-коды',
				uk: 'Очистити всі тайм-коди',
				en: 'Clear all timecodes',
				zh: '清除所有时间代码'
			},
			qwatch_balancer_change: {
				ru: 'Изменить балансер',
				uk: 'Змінити балансер',
				en: 'Change balancer',
				zh: '更改平衡器'
			},
			qwatch_balancer_timeout: {
				ru: 'Источник будет переключен автоматически через <span class="timeout">10</span> секунд.',
				uk: 'Джерело буде автоматично переключено через <span class="timeout">10</span> секунд.',
				en: 'The source will be switched automatically after <span class="timeout">10</span> seconds.',
				zh: '平衡器将在<span class="timeout">10</span>秒内自动切换。'
			},
			qwatch_balancer_no_results: {
				ru: 'Поиск на "{balancer}" не дал результатов',
				uk: 'Пошук на "{balancer}" не дав результатів',
				en: 'Search on "{balancer}" did not return any results',
				zh: '搜索 "{balancer}" 未返回任何结果'
			}
		});

		Lampa.Template.add('qwatch_css',
			'<style>' +
			'@charset \'UTF-8\';' +
			'.qwatch-container{position:relative;-webkit-border-radius:.3em;border-radius:.3em;background-color:rgba(0,0,0,0.3);display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex}' +
			'.qwatch__body{padding:1.2em;line-height:1.3;-webkit-box-flex:1;-webkit-flex-grow:1;-moz-box-flex:1;-ms-flex-positive:1;flex-grow:1;position:relative}' +
			'@media screen and (max-width:480px){.qwatch__body{padding:.8em 1.2em}}' +
			'.qwatch__img{position:relative;width:13em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0;min-height:8.2em}' +
			'.qwatch__img>img{position:absolute;top:0;left:0;width:100%;height:100%;-o-object-fit:cover;object-fit:cover;-webkit-border-radius:.3em;border-radius:.3em;opacity:0;-webkit-transition:opacity .3s;-o-transition:opacity .3s;-moz-transition:opacity .3s;transition:opacity .3s}' +
			'.qwatch__img--loaded>img{opacity:1}@media screen and (max-width:480px){.qwatch__img{width:7em;min-height:6em}}' +
			'.qwatch__folder{padding:1em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0}' +
			'.qwatch__folder>svg{width:4.4em !important;height:4.4em !important}' +
			'.qwatch__viewed{position:absolute;top:1em;left:1em;background:rgba(0,0,0,0.45);-webkit-border-radius:100%;border-radius:100%;padding:.25em;font-size:.76em}' +
			'.qwatch__viewed>svg{width:1.5em !important;height:1.5em !important}' +
			'.qwatch__episode-number{position:absolute;top:0;left:0;right:0;bottom:0;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center;-webkit-box-pack:center;-webkit-justify-content:center;-moz-box-pack:center;-ms-flex-pack:center;justify-content:center;font-size:2em}' +
			'.qwatch__loader{position:absolute;top:50%;left:50%;width:2em;height:2em;margin-left:-1em;margin-top:-1em;background:url(./img/loader.svg) no-repeat center center;-webkit-background-size:contain;-o-background-size:contain;background-size:contain}' +
			'.qwatch__head,.qwatch__footer{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-pack:justify;-webkit-justify-content:space-between;-moz-box-pack:justify;-ms-flex-pack:justify;justify-content:space-between;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}' +
			'.qwatch__timeline{margin:.8em 0}' +
			'.qwatch__timeline>.time-line{display:block !important}' +
			'.qwatch__title{font-size:1.7em;overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;line-clamp:1;-webkit-box-orient:vertical}' +
			'@media screen and (max-width:480px){.qwatch__title{font-size:1.4em}}' +
			'.qwatch__time{padding-left:2em}' +
			'.qwatch__info{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}' +
			'.qwatch__info>*{overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;line-clamp:1;-webkit-box-orient:vertical}' +
			'.qwatch__quality{padding-left:1em;white-space:nowrap}' +
			'.qwatch__scan-file{position:absolute;bottom:0;left:0;right:0}' +
			'.qwatch__scan-file .broadcast__scan{margin:0}' +
			'.qwatch-container .qwatch-split{font-size:.8em;margin:0 1em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0}' +
			'.qwatch-container.focus::after{content:\'\';position:absolute;top:-0.6em;left:-0.6em;right:-0.6em;bottom:-0.6em;-webkit-border-radius:.7em;border-radius:.7em;border:solid .3em #fff;z-index:-1;pointer-events:none}' +
			'.qwatch-container+.qwatch-container{margin-top:1.5em}' +
			'.qwatch--folder .qwatch__footer{margin-top:.8em}' +
			'.qwatch-watched{padding:1em}' +
			'.qwatch-watched__icon>svg{width:1.5em;height:1.5em}' +
			'.qwatch-watched__body{padding-left:1em;padding-top:.1em;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-flex-wrap:wrap;-ms-flex-wrap:wrap;flex-wrap:wrap}' +
			'.qwatch-watched__body>span+span::before{content:\' ● \';vertical-align:top;display:inline-block;margin:0 .5em}' +
			'.qwatch-rate{display:-webkit-inline-box;display:-webkit-inline-flex;display:-moz-inline-box;display:-ms-inline-flexbox;display:inline-flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}' +
			'.qwatch-rate>svg{width:1.3em !important;height:1.3em !important}' +
			'.qwatch-rate>span{font-weight:600;font-size:1.1em;padding-left:.7em}' +
			'.qwatch-empty{line-height:1.4}' +
			'.qwatch-empty__title{font-size:1.8em;margin-bottom:.3em}' +
			'.qwatch-empty__time{font-size:1.2em;font-weight:300;margin-bottom:1.6em}' +
			'.qwatch-empty__buttons{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex}' +
			'.qwatch-empty__buttons>*+*{margin-left:1em}' +
			'.qwatch-empty__button{background:rgba(0,0,0,0.3);font-size:1.2em;padding:.5em 1.2em;-webkit-border-radius:.2em;border-radius:.2em;margin-bottom:2.4em}' +
			'.qwatch-empty__button.focus{background:#fff;color:black}' +
			'.qwatch-empty__templates .qwatch-empty-template:nth-child(2){opacity:.5}' +
			'.qwatch-empty__templates .qwatch-empty-template:nth-child(3){opacity:.2}' +
			'.qwatch-empty-template{background-color:rgba(255,255,255,0.3);padding:1em;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center;-webkit-border-radius:.3em;border-radius:.3em}' +
			'.qwatch-empty-template>*{background:rgba(0,0,0,0.3);-webkit-border-radius:.3em;border-radius:.3em}' +
			'.qwatch-empty-template__ico{width:4em;height:4em;margin-right:2.4em}' +
			'.qwatch-empty-template__body{height:1.7em;width:70%}' +
			'.qwatch-empty-template+.qwatch-empty-template{margin-top:1em}' +
			'</style>');
		$('body').append(Lampa.Template.get('qwatch_css', {}, true));

		function resetTemplates() {
			Lampa.Template.add('qwatch_page_full', 
				'<div class="qwatch-container qwatch--full selector">' +
					'<div class="qwatch__img">' +
						'<img alt="">' +
						'<div class="qwatch__loader"/>' +
					'</div>' +
					'<div class="qwatch__body">' +
						'<div class="qwatch__head">' +
							'<div class="qwatch__title">{title}</div>' +
							'<div class="qwatch__time">{time}</div>' +
						'</div>' +
						'<div class="qwatch__timeline"/>' +
						'<div class="qwatch__footer">' +
							'<div class=\"qwatch__info\">{info}</div>' +
							'<div class=\"qwatch__quality\">{quality}</div>' +
						'</div>' +
					'</div>' +
				'</div>');
			Lampa.Template.add('qwatch_page_content_loader',
				'<div class="qwatch-empty">' +
					'<div class="broadcast__scan"><div/></div>' +
					'<div class="qwatch-empty__templates">' +
						'<div class="qwatch-empty-template selector">' +
							'<div class="qwatch-empty-template__ico"/>' +
							'<div class="qwatch-empty-template__body"/>' +
						'</div>' +
						'<div class="qwatch-empty-template">' +
							'<div class="qwatch-empty-template__ico"/>' +
							'<div class="qwatch-empty-template__body"/>' +
						'</div>' +
						'<div class="qwatch-empty-template">' +
							'<div class="qwatch-empty-template__ico"/>' +
							'<div class="qwatch-empty-template__body"/>' +
						'</div>' +
					'</div>' +
				'</div>');
			Lampa.Template.add('qwatch_page_no_answer',
				'<div class="qwatch-empty">' +
					'<div class="qwatch-empty__title">#{qwatch_balancer_no_results}</div>' +
					'<div class="qwatch-empty__time">#{qwatch_balancer_timeout}</div>' +
					'<div class="qwatch-empty__buttons">' +
						'<div class="qwatch-empty__button selector cancel">#{cancel}</div>' +
						'<div class="qwatch-empty__button selector change">#{qwatch_balancer_change}</div>' +
					'</div>' +
					'<div class="qwatch-empty__templates">' +
						'<div class="qwatch-empty-template">' +
							'<div class="qwatch-empty-template__ico"/>'+
							'<div class="qwatch-empty-template__body"/>' +
						'</div>' +
						'<div class="qwatch-empty-template">' +
							'<div class="qwatch-empty-template__ico"/>' +
							'<div class="qwatch-empty-template__body"/>' +
						'</div>' +
						'<div class="qwatch-empty-template">' +
							'<div class="qwatch-empty-template__ico"/>' +
							'<div class="qwatch-empty-template__body"/>' +
						'</div>' +
					'</div>' +
				'</div>');
			Lampa.Template.add('qwatch_entry_rating', 
				'<div class="qwatch-rate">' +
					'<svg width="17" height="16" viewBox="0 0 17 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
						'<path d="M8.39409 0.192139L10.99 5.30994L16.7882 6.20387L12.5475 10.4277L13.5819 15.9311L8.39409 13.2425L3.20626 15.9311L4.24065 10.4277L0 6.20387L5.79819 5.30994L8.39409 0.192139Z" fill="#fff"/>' +
					'</svg>' +
					'<span>{rate}</span>' +
				'</div>');
			Lampa.Template.add('qwatch_page_folder', 
				'<div class="qwatch-container qwatch--folder selector">' +
					'<div class="qwatch__folder">' +
						'<svg viewBox="0 0 128 112" fill="none" xmlns="http://www.w3.org/2000/svg">' +
							'<rect y="20" width="128" height="92" rx="13" fill="white"/><path d="M29.9963 8H98.0037C96.0446 3.3021 91.4079 0 86 0H42C36.5921 0 31.9555 3.3021 29.9963 8Z" fill="white" fill-opacity="0.23"/><rect x="11" y="8" width="106" height="76" rx="13" fill="white" fill-opacity="0.51"/>' +
						'</svg>' +
					'</div>' +
					'<div class="qwatch__body">' +
						'<div class="qwatch__head">' +
							'<div class="qwatch__title">{title}</div>' +
							'<div class="qwatch__time">{time}</div>' +
						'</div>' +
						'<div class="qwatch__footer">' +
							'<div class="qwatch__info">{info}</div>' +
						'</div>' +
					'</div>' +
				'</div>');
			Lampa.Template.add('qwatch_page_watched', 
				'<div class="qwatch-container qwatch-watched selector">' +
					'<div class="qwatch-watched__icon">' +
						'<svg width="21" height="21" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">' +
							'<circle cx="10.5" cy="10.5" r="9" stroke="currentColor" stroke-width="3"/>' +
							'<path d="M14.8477 10.5628L8.20312 14.399L8.20313 6.72656L14.8477 10.5628Z" fill="currentColor"/>' +
						'</svg>' +
					'</div>' +
					'<div class="qwatch-watched__body"/>' +
				'</div>');
		}

		Lampa.Listener.follow('full', function (event) {
			if (event.type == 'complite') {
				var render = event.object.activity.render();

				// render button
				var onlineButton = $(Lampa.Lang.translate(
					'<div class="full-start__button selector view--qwatch" data-subtitle="' + manifest.name + ' ' + manifest.version + '">' +
					'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
					'<path fill="currentColor" fill-rule="evenodd" d="M3.07 6a8.025 8.025 0 014.262-3.544A12.802 12.802 0 005.595 6H3.07zm-.818 2A8.015 8.015 0 002 10c0 .69.088 1.36.252 2h2.89A13.886 13.886 0 015 10c0-.704.051-1.371.143-2H2.252zm4.916 0C7.06 8.62 7 9.286 7 10c0 .713.061 1.38.168 2h5.664c.107-.62.168-1.287.168-2 0-.714-.061-1.38-.168-2H7.168zm7.69 0c.09.629.142 1.296.142 2s-.051 1.371-.143 2h2.891c.165-.64.252-1.31.252-2s-.087-1.36-.252-2h-2.89zm2.072-2h-2.525a12.805 12.805 0 00-1.737-3.544A8.025 8.025 0 0116.93 6zm-4.638 0H7.708c.324-.865.725-1.596 1.124-2.195.422-.633.842-1.117 1.168-1.452.326.335.746.82 1.168 1.452.4.599.8 1.33 1.124 2.195zm-1.124 10.195c.4-.599.8-1.33 1.124-2.195H7.708c.324.865.725 1.596 1.124 2.195.422.633.842 1.117 1.168 1.452.326-.335.746-.82 1.168-1.452zM3.07 14h2.525a12.802 12.802 0 001.737 3.544A8.025 8.025 0 013.07 14zm9.762 3.305a12.9 12.9 0 01-.164.24A8.025 8.025 0 0016.93 14h-2.525a12.805 12.805 0 01-1.573 3.305zM20 10c0 5.52-4.472 9.994-9.99 10h-.022C4.47 19.994 0 15.519 0 10 0 4.477 4.477 0 10 0s10 4.477 10 10z"/>' +
					'</svg>' +
					'<span>#{qwatch_title}</span>' +
					'</div>'));
				var torrentButton = render.find('.view--torrent');
				if (torrentButton.length)
					torrentButton.before(onlineButton);
				else
					render.find('.full-start__button:last').after(onlineButton);

				// register button action
				onlineButton.on('hover:enter', function () {
					// register templates
					resetTemplates();

					// register component
					Lampa.Component.add('qwatch', QWatchComponent);

					// register activity
					var movieId = Lampa.Utils.hash(event.data.movie.number_of_seasons ? event.data.movie.original_name : event.data.movie.original_title);
					var all = Lampa.Storage.get('clarification_search', '{}');
					Lampa.Activity.push({
						url: '',
						title: Lampa.Lang.translate('qwatch_title'),
						component: 'qwatch',
						search: all[movieId] ? all[movieId] : event.data.movie.title,
						movie: event.data.movie,
						page: 1,
						clarification: all[movieId] ? true : false
					});
				});
			}
		});

		if (Lampa.Manifest.app_digital >= 177) {
			var balancers_sync = ["filmix", 'filmixtv', "fxapi", "rezka", "rhsprem", "lumex", "videodb", "collaps", "collaps-dash", "hdvb", "zetflix", "kodik", "ashdi", "kinoukr", "kinotochka", "remux", "iframevideo", "cdnmovies", "anilibria", "animedia", "animego", "animevost", "animebesst", "redheadsound", "alloha", "animelib", "moonanime", "kinopub", "vibix", "vdbmovies", "fancdn", "cdnvideohub", "vokino", "rc/filmix", "rc/fxapi", "rc/rhs", "vcdn", "videocdn", "mirage", "hydraflix", "videasy", "vidsrc", "movpi", "vidlink", "twoembed", "autoembed", "smashystream", "autoembed", "rgshows", "pidtor", "videoseed"];
			balancers_sync.forEach(function (name) {
				Lampa.Storage.sync('qwatch_choice_' + name, 'object_object');
			});
			Lampa.Storage.sync('qwatch_watched_last', 'object_object');
		}
	}

	Lampa.Storage.listener.follow('change', function (event) {
		if (event.name == 'activity') {
			if (Lampa.Activity.active().component == 'qwatch') {
				var add_ads = setInterval(function () {
					if (document.querySelector('.qwatch-watched') !== null) {
						$('.qwatch-watched').remove();
						clearInterval(add_ads);
					}
				}, 50);
				var add_ads2 = setInterval(function () {
					if (document.querySelector('.filter--sort') !== null) {
						$('.filter--sort').remove();
						clearInterval(add_ads2);
					}
				}, 50);
			}
		}
	})

	if (!window.plugin_qwatch_ready) startPlugin();
})();
