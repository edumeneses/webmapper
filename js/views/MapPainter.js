class MapPainter {
    constructor(map, canvas, frame, graph)
    {
        this.map = map;
        this.canvas = canvas;
        this.frame = frame;
        this.graph = graph;
        this.pathspecs = [];
        this.paths = [];
        this.attributes = [];
        this._highlight = false;
        this.midPointInflation = 0.2;
        this.labels = [];
        this.updateAttributes(); // in case paths rely on certain attributes e.g. in grid view
    }

    // APPEARANCE //////////////////////////////////////////////////////////////
    // Subclasses should override these methods to change the appearance of maps

    // Updates the elements of the pathspecs array based on x,y coordinates of
    // the sources and destinations referred to by the map. This function should
    // only be called if the map is in a valid state according to the
    // _mapIsValid() function. See draw().

    oneToOne(src, dst, i)
    {
        // draw a curved line from src to dst
        let mid = {x: (src.x + dst.x) * 0.5, y: (src.y + dst.y) * 0.5};
        let origin = {x: this.frame.width * 0.5, y: this.frame.height * 0.5};

        mid.x = mid.x + (mid.x - origin.x) * this.midPointInflation;
        mid.y = mid.y + (mid.y - origin.y) * this.midPointInflation;

        this.pathspecs[i] = [['M', src.x, src.y],
                             ['S', mid.x, mid.y, dst.x, dst.y]];
    }

    updatePaths()
    {
        let i = 0, len = this.map.srcs.length;
        let dst = this.map.dst.position;
        let node = len > 1 ? this.getNodePosition() : dst;
        for (; i < len; i++) {
            this.oneToOne(this.map.srcs[i].position, node, i);
        }
        if (len > 1) {
            this.oneToOne(node, dst, i);
            this.pathspecs[i+1] = this.circle_spec(node.x, node.y);
        }
    }

    // Updates the properties of the attributes object
    updateAttributes()
    {
        return this._defaultAttributes();
    }

    // INTERACTION /////////////////////////////////////////////////////////////
    // These methods should be called by the main view to set the callbacks for
    // events generated by elements owned by this map view

    hover(f_in, f_out) 
    {
        this.paths.forEach(function(path)
        {
            path.unhover();
            path.hover(f_in, f_out);
        });
    }
    //click(func) { _setCallbacks('click', func); }
    //drag(func) { _setCallbacks('hover', func); }
    //cross(func) { _setCallbacks('hover', func); }

    // OTHER ///////////////////////////////////////////////////////////////////

    // Use these methods to set the state of the view
    show() { if (this.map.hidden) { this.map.hidden = false; this.draw(0); }}
    hide() { if (!this.map.hidden) { this.map.hidden = true; this.draw(0); }}
    highlight() { if (!this._highlight) { this._highlight = true; this.draw(0); }}
    unhighlight() { if (this._highlight) { this._highlight = false; this.draw(0); }}

    // The draw function causes the map view to be updated based on the current
    // state of the map which it refers to. This method should not be overridden
    draw(duration) 
    {
        if (!this._mapIsValid()) return;
        else if (this.stolen) return;
        if (this.map.srcs.filter(s => !s.hidden).length === 0
            || this.map.dst.hidden)
        {   // no need to update, everything will be hidden anyways
            this._setPaths(duration);
            return; 
        }
        this.updatePaths();
        this.updateAttributes();
        this._setPaths(duration);
    }

    edge_intersection(x1, y1, x2, y2)
    {
        let ret = false;
        x1 = x1 * this.canvas.zoom + this.canvas.pan.x;
        y1 = y1 * this.canvas.zoom + this.canvas.pan.y;
        x2 = x2 * this.canvas.zoom + this.canvas.pan.x;
        y2 = y2 * this.canvas.zoom + this.canvas.pan.y;
        for (let i in this.paths)
        {
            if (this.paths[i] === null) continue;
            let intersection = edge_intersection(this.paths[i], x1, y1, x2, y2);
            if (intersection) this.intersected = this.paths[i];
            ret = ret || intersection;
        }
        return ret;
    }

    closest_point(x, y)
    {
        let best_dist = null; 
        let best_point = null;
        for(let p of this.paths)
        {
            if (p === null) continue;
            let point = closest_point(p, x, y);
            if (best_dist === null || point.distance < best_dist) 
            {
                best_point = point;
                best_dist = point.distance;
            }
        }
        if (best_point === null) console.log('error: no closest point found');
        return best_point;
    }

    remove()
    {
        this.paths.forEach(function(path)
        {
            path.stop();
            path.unhover();
            path.undrag();
            path.remove();
            path = null;
        });
        this.labels.forEach(l => l.remove());
        this.labels = [];
    }

    stop() {} unhover() {} undrag() {} animate() {this.remove()} // methods that might get called if the caller doesn't know about the new MapPainter class yet and thinks map.view is a Raphael element

    // Check if this.map has the necessary properties allowing it to be drawn
    // Subclasses could override this method to define custom invariants
    _mapIsValid()
    {
        if (   !this.map
            || !this.map.srcs[0] || !this.map.srcs[0].position
            || !this.map.dst || !this.map.dst.position)
        {
            console.log('error drawing map: map missing src or dst position', this.map);
            return false;
        }
        else return true;
    }

    // Get the default attributes for the appearance of a map. Subclasses can
    // call this method in getAttributes() and then change the defaults in case
    // they wish to use most of the defaults
    _defaultAttributes(count)
    {
        if (typeof count === 'undefined') count = 1;
        for (var i = 0; i < count; i++)
        {
            // TODO: see if these properties can be moved to CSS
            this.attributes[i] = 
            { 'stroke': (this.map.selected ? MapPainter.selectedColor : MapPainter.defaultColor )
            , 'stroke-dasharray': (this.map.muted ? MapPainter.mutedDashes : MapPainter.defaultDashes)
            , 'stroke-opacity': (this.map.status == 'staged' ? MapPainter.stagedOpacity : MapPainter.defaultOpacity)
            , 'stroke-width': (this.map.selected ? MapPainter.boldStrokeWidth : MapPainter.defaultStrokeWidth)
            , 'fill': 'none'
            , 'arrow-start': (this.map.protocol == 'TCP' ? 'oval' : 'none')
            , 'arrow-end': 'block-wide-long'
            };
        }
    }

    // Set the path and other attributes for all the path elements owned by this
    _setPaths(duration)
    {
        let count = this.pathspecs.length;
        if (this.paths.length > count) count = this.paths.length;
        for (let i = 0; i < count; ++i)
        {
            let pathspec = this.pathspecs[i];
            let len = Raphael.getTotalLength(pathspec);

            if (this.shortenPath) {
                let shorten = this.shortenPath * this.canvas.zoom;
                pathspec = Raphael.getSubpath(pathspec, shorten, len - shorten);
            }
            let path = this.paths[i];
            let attributes = this.attributes[i];

            if (typeof pathspec === 'undefined' || pathspec === null)
            {
                if (typeof path !== 'undefined') 
                {
                    path.remove();
                    delete this.paths[i];
                }
                continue;
            }

            if (typeof attributes === 'undefined') 
                attributes = this.attributes[0];

            // hide arrowhead if path is short to avoid Raphael error message
            if (len < 50)
                attributes['arrow-end'] = 'none';

            if (typeof path === 'undefined' || path[0] == null) 
            {
                this.paths[i] = this.canvas.path(pathspec);
                path = this.paths[i];
                path.attr(attributes);
            }
            else 
            {
                path.stop();
                path.attr(attributes);
                if (!duration || duration < 0) path.attr({path: pathspec});
                else path.animate({'path': pathspec}, duration, '>');
                path.toFront();
            }
            path.show();

            // One could also check other conditions which would indicate that
            // a signal is hidden, e.g. is it missing a view? Is its device hidden?
            // Rather than check a million conditions, one should arguably just make
            // sure that signals are marked as hidden when appropriate
            if (this.map.hidden || this.map.dst.hidden
                || this.map.srcs.every(s => s.hidden))
                path.hide();
            // maps with multiple sources have to manually hide paths by setting stroke
            // and fill to 'none' if only some of their sources are hidden
        }
        if (this.map.hidden || this.map.dst.hidden
            || !this.map.selected || this.map.srcs.length == 1) {
            this.labels.forEach(l => l.remove());
            this.labels = [];
            return;
        }
        // assign labels
        let attrs = {'font-size': 16,
                     'opacity': 1,
                     'fill': 'white',
                     'pointer-events': 'none'};
        for (var i = 0; i < this.map.srcs.length; i++) {
            let l = Raphael.getTotalLength(this.pathspecs[i]);
            if (l) {
                let p = Raphael.getPointAtLength(this.pathspecs[i], 20);
                if (this.labels.length <= i) {
                    this.labels[i] = this.canvas.text(p.x, p.y, 'x'+i).attr(attrs);
                }
                else {
                    this.labels[i].attr({'x': p.x, 'y': p.y});
                }
            }
            else if (this.labels[i]) {
                this.labels[i].remove();
                delete this.labels[i];
            }
        }
        if (this.labels.length) {
            this.labels.forEach(l => l.toFront());
        }
    }

    getNodePosition(offset)
    {
        let dst = this.map.dst.position;
        let sigs = this.map.srcs.filter(s => !s.hidden).map(s => s.position);
        if (sigs.length === 0) return null;
        sigs = sigs.concat([dst]);

        let x = sigs.map(s => s.x).reduce((accum, s) => accum + s) / sigs.length;
        let y = sigs.map(s => s.y).reduce((accum, s) => accum + s) / sigs.length;

        if (offset) {
            if (x === dst.x)
                x += offset * dst.vx;
            if (y === dst.y)
                y += offset * dst.vy;
        }

        return {x: x, y: y, vy: 0};
    }

    circle_spec(x, y, radius = 10)
    {
        return [['M', x - radius, y],
                ['A', radius, radius, 0, 0, 0, x + radius, y],
                ['A', radius, radius, 0, 0, 0, x - radius, y],
                ['A', radius, radius, 0, 0, 0, x + radius, y]]; // repeated in case of shortening in e.g. parallel view
    }

    // copy the paths from another painter e.g. before replacing it
    copy(otherpainter)
    {
        this.paths = otherpainter.paths;
        this.labels = otherpainter.labels;
        this._highlight = otherpainter._highlight;
    }
}

// These static properties set the default attributes of MapPainters; edit them
// to change the way default maps look globally
MapPainter.selectedColor = 'red';
MapPainter.defaultColor = 'white';
MapPainter.mutedDashes = '-';
MapPainter.defaultDashes = '';
MapPainter.stagedOpacity = 0.5;
MapPainter.defaultOpacity = 1.0;
MapPainter.boldStrokeWidth = 5;
MapPainter.defaultStrokeWidth = 4;
MapPainter.shortenPath = 0;
